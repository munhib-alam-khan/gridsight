// CTBCM open-access calculator, in the browser. A line-for-line port of
// pipeline/ctbcm/bpc.py so the static site needs no server; tests/test_static.py
// checks that both give the same numbers to 4 decimal places.
(function () {
  const HOURS_PER_MONTH = 24 * 365.25 / 12;

  function engine(E) {
    // E: {grid_charges:[...], tariff:[...], losses:{cat:[dist,trans]}, reserve_margin, capacity_price,
    //     ancillary, solar_firm_share, dss, peak:{month:[h..]}, solar:{"m-d":[24]}, scenarios:[{key, description, t0, prices}]}
    const peak = {};
    for (const [m, hs] of Object.entries(E.peak)) peak[+m] = new Set(hs);
    const loss = (cat) => 1 - (1 - E.losses[cat][0]) * (1 - E.losses[cat][1]);
    const scen = {};
    E.scenarios.forEach((s) => {
      const t0 = Date.UTC(+s.t0.slice(0, 4), +s.t0.slice(5, 7) - 1, +s.t0.slice(8, 10), +s.t0.slice(11, 13));
      const n = s.prices.length, month = new Int8Array(n), day = new Int8Array(n), hour = new Int8Array(n);
      for (let i = 0; i < n; i++) {
        const d = new Date(t0 + i * 3600e3);          // UTC arithmetic: PKT has no daylight saving
        month[i] = d.getUTCMonth() + 1; day[i] = d.getUTCDate(); hour[i] = d.getUTCHours();
      }
      scen[s.key] = { ...s, n, month, day, hour, mean: s.prices.reduce((a, b) => a + b, 0) / n };
    });

    function kw(c, S) {
      const out = new Float64Array(S.n);
      for (let i = 0; i < S.n; i++) {
        let v;
        const h = S.hour[i];
        if (c.shape === "continuous") v = 1;
        else if (c.shape === "two_shift") v = h >= 6 && h < 22 ? 1 : 0.3;
        else if (c.shape === "day_shift") v = h >= 8 && h < 17 ? 1 : 0.15;
        else if (c.shape === "peak_avoider") v = peak[S.month[i]].has(h) ? 0.2 : 1;
        else throw new Error("shape " + c.shape);
        out[i] = c.max_demand_kw * v;
      }
      return out;
    }
    const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
    const max = (a) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
    const months = (S) => S.n / HOURS_PER_MONTH;
    const sanctioned = (c) => c.sanctioned_kw || c.max_demand_kw / 0.9;
    const frame = (parts, kwh) => {
      const rows = Object.entries(parts).map(([component, rs]) => ({ component, rs, rs_per_kwh: rs / kwh }));
      const tot = rows.reduce((a, r) => a + r.rs, 0);
      rows.push({ component: "total", rs: tot, rs_per_kwh: tot / kwh });
      return rows;
    };
    const total = (rows) => rows[rows.length - 1].rs;

    function regulated(c, S, fpa) {
      const t = E.tariff.find((x) => x.tariff_category === c.category);
      const k = kw(c, S), kwh = sum(k);
      let energy = 0;
      for (let i = 0; i < S.n; i++) energy += k[i] * (peak[S.month[i]].has(S.hour[i]) ? t.peak_rs_kwh : t.offpeak_rs_kwh);
      return frame({
        "energy (time-of-use)": energy,
        "fixed charge (on max demand)": t.fixed_rs_kw_month * max(k) * months(S),
        "debt service surcharge": t.dss_rs_kwh * kwh,
        "FPA/QTA adjustments": fpa * kwh,
      }, kwh);
    }

    function solarProfile(S) {
      const out = new Float64Array(S.n);
      for (let i = 0; i < S.n; i++) {
        const d = S.month[i] === 2 && S.day[i] === 29 ? 28 : S.day[i];
        const row = E.solar[S.month[i] + "-" + d];
        out[i] = row ? row[S.hour[i]] : 0;
      }
      return out;
    }

    function openAccess(c, s, S) {
      const k = kw(c, S), kwh = sum(k), L = loss(c.category), P = S.prices;
      const g = E.grid_charges.find((x) => x.tariff_category === c.category && x.variant === s.route);
      const M = months(S), parts = {};
      let firm = 0;
      if (s.kind === "market") {
        let e = 0; for (let i = 0; i < S.n; i++) e += (k[i] / (1 - L)) * P[i];
        parts["energy bought at hourly SMP"] = e;
        parts["supplier margin"] = s.supplier_margin * kwh;
      } else if (s.kind === "fixed_price") {
        parts["energy at contract price"] = s.contract_price * (kwh / (1 - L));
      } else if (s.kind === "solar_plus_market") {
        const prof = solarProfile(S);
        let gen = 0, shortC = 0, surplusC = 0;
        for (let i = 0; i < S.n; i++) {
          const need = k[i] / (1 - L), gi = s.solar_mw * 1000 * prof[i];
          gen += gi; shortC += Math.max(need - gi, 0) * P[i]; surplusC += Math.max(gi - need, 0) * P[i];
        }
        parts["solar energy at contract price"] = s.solar_price * gen;
        parts["shortfall bought at hourly SMP"] = shortC;
        parts["surplus solar sold at hourly SMP"] = -surplusC;
        parts["supplier margin"] = s.supplier_margin * kwh;
        firm = s.solar_mw * E.solar_firm_share;
      } else throw new Error("kind " + s.kind);
      parts["grid charges: transmission"] = g.transmission_rs_kwh * kwh;
      parts["grid charges: distribution"] = g.distribution_rs_kwh * kwh;
      parts["grid charges: cross-subsidy"] = g.cross_subsidy_rs_kwh * kwh;
      if (g.stranded_rs_kwh) parts["grid charges: stranded cost"] = g.stranded_rs_kwh * kwh;
      parts["grid charges: fixed (on sanctioned load)"] = g.fixed_rs_kw_month * sanctioned(c) * M;
      if (s.dss) parts["debt service surcharge"] = E.dss * kwh;
      if (s.kind !== "fixed_price") {
        const oblig = max(k) / 1000 / (1 - L) * (1 + E.reserve_margin);
        parts["capacity obligation"] = Math.max(oblig - firm, 0) * s.capacity_price * M / 12;
        parts["ancillary services"] = E.ancillary * kwh;
      }
      return frame(parts, kwh);
    }

    function breakeven(c, s, S, regTotal) {
      const k = kw(c, S), kwh = sum(k);
      if (s.kind === "market") {
        const base = total(openAccess(c, { ...s, supplier_margin: 0 }, S));
        return { term: "max supplier margin (Rs/kWh)", value: (regTotal - base) / kwh };
      }
      if (s.kind === "fixed_price") {
        const base = total(openAccess(c, { ...s, contract_price: 0 }, S));
        return { term: "max contract price at the generator (Rs/kWh)", value: (regTotal - base) / (kwh / (1 - loss(c.category))) };
      }
      const base = total(openAccess(c, { ...s, solar_price: 0 }, S));
      const prof = solarProfile(S); let gen = 0;
      for (let i = 0; i < S.n; i++) gen += s.solar_mw * 1000 * prof[i];
      return { term: "max solar price (Rs/kWh)", value: gen > 0 ? (regTotal - base) / gen : null };
    }

    function compare(c, s, S, fpa) {
      const reg = regulated(c, S, fpa), oa = openAccess(c, s, S);
      const k = kw(c, S), kwh = sum(k), saving = total(reg) - total(oa);
      return {
        res: { kwh, load_factor: kwh / (max(k) * S.n), regulated_rs_kwh: total(reg) / kwh, open_access_rs_kwh: total(oa) / kwh,
               saving_rs_kwh: saving / kwh, saving_rs_per_year: saving / S.n * 8766, breakeven: breakeven(c, s, S, total(reg)) },
        reg, oa,
      };
    }

    function exitImpact(c, route, S) {
      const reg = regulated(c, S, 0), k = kw(c, S), kwh = sum(k), L = loss(c.category);
      const g = E.grid_charges.find((x) => x.tariff_category === c.category && x.variant === route);
      const kept = (g.total_variable_rs_kwh * kwh + g.fixed_rs_kw_month * sanctioned(c) * months(S)) / kwh;
      const dss = reg.find((r) => r.component === "debt service surcharge").rs;
      const tariff = (total(reg) - dss) / kwh;
      let av = 0; for (let i = 0; i < S.n; i++) av += k[i] * S.prices[i];
      const avoided = av / (1 - L) / kwh;
      return { tariff_revenue_rs_kwh: tariff, kept_as_grid_charges_rs_kwh: kept, lost_rs_kwh: tariff - kept,
               kwh_per_year: kwh / S.n * 8766, avoided_energy_rs_kwh: avoided, shifted_to_others_rs_kwh: tariff - kept - avoided };
    }

    // same shape as POST /api/ctbcm
    function compute(inp) {
      const c = { category: inp.category, max_demand_kw: inp.max_demand_kw, shape: inp.shape };
      const s = { kind: inp.kind, route: inp.route, supplier_margin: inp.supplier_margin, contract_price: inp.contract_price,
                  solar_mw: inp.solar_mw, solar_price: inp.solar_price, dss: inp.dss !== false, capacity_price: E.capacity_price };
      const fpa = inp.fpa_qta || 0;
      const scenarios = E.scenarios.map((x) => {
        const S = scen[x.key], r = compare(c, s, S, fpa).res;
        return { scenario: x.key, description: x.description, mean_smp: S.mean, regulated_rs_kwh: r.regulated_rs_kwh,
                 open_access_rs_kwh: r.open_access_rs_kwh, saving_rs_kwh: r.saving_rs_kwh, saving_rs_m_per_year: r.saving_rs_per_year / 1e6,
                 breakeven_term: r.breakeven.term, breakeven_value: r.breakeven.value };
      });
      const key = scen[inp.scenario] ? inp.scenario : "last12", S = scen[key];
      const r = compare(c, s, S, fpa);
      const prof = [...Array(24).keys()].map((h) => c.max_demand_kw * (c.shape === "continuous" ? 1 : c.shape === "two_shift" ? (h >= 6 && h < 22 ? 1 : 0.3)
        : c.shape === "day_shift" ? (h >= 8 && h < 17 ? 1 : 0.15) : peak[1].has(h) ? 0.2 : 1));
      return { scenarios, selected: key, selected_description: S.description, result: r.res, regulated: r.reg, open_access: r.oa,
               exit: exitImpact(c, inp.route, S), profile_kw: prof, loss: loss(c.category) };
    }
    return { compute };
  }
  const g = typeof window !== "undefined" ? window : globalThis;
  g.CTBCM = { engine };
  if (typeof module !== "undefined") module.exports = { engine };
})();
