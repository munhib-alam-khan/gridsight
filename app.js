const { lineChart, barChart, heatmap, fmt, css } = window.Charts;
const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const cache = {};
// Two ways to run: with the Python server (api/...) or as a static site (data/*.json, set by
// pipeline.export_static). Paths are relative so the site also works under a sub-path.
const STATIC = !!window.GS_STATIC;
function url(u) {
  if (!STATIC) return u.replace(/^\//, "");
  const m = u.match(/^\/api\/backtest\?month=([\d-]+)&horizon=(\w+)/);
  if (m) return `data/backtest/${m[2]}_${m[1]}.json`;
  return { "/api/overview": "data/overview.json", "/api/forecast": "data/forecast.json", "/api/ctbcm/context": "data/ctbcm_context.json",
           "/api/quality": "data/quality.json", "/api/briefs": "data/briefs.json", "/api/health": "data/health.json" }[u] || u;
}
async function get(u) {
  const k = url(u);
  if (!cache[k]) cache[k] = fetch(k).then((r) => { if (!r.ok) throw new Error(k + " " + r.status); return r.json(); });
  return cache[k];
}
let engineP;
async function ctbcmCompute(body) {
  if (!STATIC) {
    const r = await fetch("api/ctbcm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  if (!(body.max_demand_kw > 0 && body.max_demand_kw <= 500000)) throw new Error("maximum demand must be between 1 and 500,000 kW");
  for (const k of ["supplier_margin", "contract_price", "solar_mw", "solar_price"]) if (!(body[k] >= 0)) throw new Error(k.replace("_", " ") + " cannot be negative");
  engineP = engineP || get("data/ctbcm_engine.json").then((E) => window.CTBCM.engine(E));
  return (await engineP).compute(body);
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v, d = 0) => (v == null ? "–" : (v * 100).toFixed(d) + "%");
const sgn = (v, d = 0) => (v == null ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%");
const rs = (v, d = 1) => (v == null ? "–" : "Rs " + v.toFixed(d));
const H24 = [...Array(24).keys()];
const EXT = 50;

// ---------------------------------------------------------------- theme
(function theme() {
  const saved = (() => { try { return localStorage.getItem("gs-theme"); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gs-theme", next); } catch {}
    route();
  });
})();

// ---------------------------------------------------------------- router
const pages = { market, forecast, calculator, quality, briefs, method };
async function route() {
  const name = (location.hash.replace(/^#\/?/, "") || "market").split("?")[0];
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + name));
  const fn = pages[name] || market;
  try { await fn(); } catch (e) { view.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p>`; console.error(e); }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(route, 250); });
get("/api/health").then((h) => { $("#freshness").textContent = "Prices through " + new Date(h.data_through).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }); });

// ================================================================ MARKET
async function market() {
  const d = await get("/api/overview");
  const s = d.stats, p = d.prev, y = d.yoy;
  const ch = (a, b) => (b ? a / b - 1 : null);
  view.innerHTML = `
    <p class="eyebrow">Pakistan wholesale power · ${esc(d.month_label)}</p>
    <h1>${headline(d)}</h1>
    <div class="figs">
      <div class="fig"><div class="l">Average price</div><div class="v">${rs(s.mean)}</div>
        <div class="d">${sgn(ch(s.mean, p.mean))} on ${esc(d.profile.labels[1])}${y ? ` · ${sgn(ch(s.mean, y.mean))} on a year ago` : ""}</div></div>
      <div class="fig"><div class="l">Hours at Rs ${EXT} or more</div><div class="v">${s.n_ext}</div>
        <div class="d">${pct(s.share_ext)} of the month · previous ${p.n_ext}</div></div>
      <div class="fig"><div class="l">Night vs midday</div><div class="v">${s.night.toFixed(0)} / ${s.midday.toFixed(0)}</div>
        <div class="d">Rs/kWh, 00–06h vs 10–16h</div></div>
      <div class="fig"><div class="l">Fuel-shock monitor</div><div class="v"><span class="pill ${d.fuel.status}">${d.fuel.status}</span></div>
        <div class="d">Brent $${d.fuel.brent.toFixed(0)} in ${fmt.month(d.fuel.month).split(" ")[0]}, ${sgn(d.fuel.change_3m)} over 3 months</div></div>
    </div>
    <div class="lede">${d.narrative.map((t) => `<p>${esc(t)}</p>`).join("")}</div>

    <h2>The average day</h2>
    <p class="sub">Price by hour of day, averaged over the month. The shape is the story: where the evening and night sit against midday.</p>
    <div id="c-profile"></div>
    <p class="cap">Hour-beginning, Pakistan Standard Time. The dashed red line is Rs ${EXT}/kWh, the threshold KE uses for extreme hours.</p>

    <h2>Every hour of the last three months</h2>
    <p class="sub">Each row is a day, each column an hour. Darker is more expensive.</p>
    <div id="c-heat"></div>

    <h2>Month by month</h2>
    <div class="cols even">
      <div><h3>Average price, Rs/kWh</h3><div id="c-monthly"></div></div>
      <div><h3>Hours at Rs ${EXT} or more</h3><div id="c-ext"></div></div>
    </div>
    <p class="cap">Two charts, one scale each. Before April 2026 only two hours in the whole record reached Rs ${EXT}.</p>

    <h2>What set the price</h2>
    <div class="cols">
      <div>
        <h3>Brent crude, US$ per barrel, and the fuel-shock signal</h3>
        <div id="c-brent"></div>
        <p class="cap">Red: Brent at or above $${d.fuel.rules.red} after rising ${pct(d.fuel.rules.rise_3m)}+ in three months. Amber: a ${pct(d.fuel.rules.rise_3m)}+ three-month or ${pct(d.fuel.rules.rise_1m)}+ one-month rise from $${d.fuel.rules.amber}+.
        It has fired in ${d.fuel.history.map((h) => fmt.month(h.month) + " (" + h.status + ")").join(", ")}. One regime change in the price record makes this a monitor, not a validated predictor.</p>
      </div>
      <div>
        <h3>Fuel cost by technology${d.cppa ? ", " + fmt.month(d.cppa.month) : ""}</h3>
        ${d.cppa ? `<table><tr><th>Fuel</th><th class="n">Rs/kWh</th><th class="n">Month before</th><th class="n">TWh</th></tr>
        ${d.cppa.rows.map((r) => `<tr><td>${esc(r.fuel)}</td><td class="n">${r.rs_kwh.toFixed(1)}</td><td class="n">${r.prev == null ? "–" : r.prev.toFixed(1)}</td><td class="n">${r.twh.toFixed(2)}</td></tr>`).join("")}</table>
        <p class="cap">CPPA-G energy purchases: fuel charges divided by energy bought. The most expensive fuel that runs sets the evening price; in 2026 that is furnace oil.</p>` : ""}
      </div>
    </div>`;

  lineChart($("#c-profile"), {
    x: H24, series: [
      d.profile.yoy && { name: d.profile.labels[2], values: d.profile.yoy, color: css("--ink-3"), dash: "4 3", width: 1.5 },
      { name: d.profile.labels[1], values: d.profile.prev, color: css("--series-2"), width: 1.75 },
      { name: d.profile.labels[0], values: d.profile.cur, color: css("--series-1"), width: 2.5 },
    ].filter(Boolean),
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21], xTick: fmt.hour, tipX: (h) => fmt.hour(h) + "–" + fmt.hour((h + 1) % 24),
    yFmt: (v) => v.toFixed(0), ref: { y: EXT, label: "Rs " + EXT }, height: 290,
  });
  heatmap($("#c-heat"), {
    rows: d.grid.days, cols: H24.map((h) => String(h).padStart(2, "0")), values: d.grid.values, max: 60, min: 0, cellH: 5.5,
    rowTick: (i) => { const dd = new Date(d.grid.days[i]); return dd.getDate() === 1 ? dd.toLocaleDateString("en-GB", { month: "short" }) : null; },
    tip: (i, j, v) => `<b>${fmt.day(d.grid.days[i])}, ${fmt.hour(j)}</b><div>${v == null ? "no data" : rs(v) + "/kWh"}</div>`,
    scaleLabel: (v) => "Rs " + v,
  });
  const mo = d.monthly;
  lineChart($("#c-monthly"), {
    x: mo.map((r) => r.month), xType: "time", series: [{ name: "Average", values: mo.map((r) => r.mean), color: css("--series-1"), label: false }],
    xTicks: mo.filter((r) => new Date(r.month).getMonth() % 6 === 0).map((r) => r.month), xTick: fmt.month, tipX: fmt.month,
    yFmt: (v) => v.toFixed(0), height: 220, rightPad: 12,
  });
  barChart($("#c-ext"), {
    labels: mo.map((r) => r.month), values: mo.map((r) => r.n_ext), color: css("--series-2"),
    xTick: (l, i) => (new Date(l).getMonth() % 6 === 0 ? fmt.month(l) : ""), height: 220,
    tip: (i) => `<b>${fmt.month(mo[i].month)}</b><div>${mo[i].n_ext} hours at Rs ${EXT}+</div><div class="muted">high ${rs(mo[i].max)}</div>`,
  });
  const fs = d.fuel.series;
  lineChart($("#c-brent"), {
    x: fs.map((r) => r.month), xType: "time",
    series: [{ name: "Brent", values: fs.map((r) => r.brent), color: css("--ink-2"), label: false }],
    xTicks: fs.filter((r) => new Date(r.month).getMonth() === 0).map((r) => r.month), xTick: (v) => new Date(v).getFullYear(),
    tipX: (v) => { const r = fs.find((x) => x.month === v); return fmt.month(v) + (r && r.status !== "clear" ? ` · ${r.status} signal` : ""); },
    yFmt: (v) => "$" + v.toFixed(0), height: 210, rightPad: 12, yMin: 40,
  });
  // status markers on the brent chart
  markStatus($("#c-brent"), fs);
}

function markStatus(host, fs) {
  const svg = host.querySelector("svg"); const path = svg.querySelector("path");
  if (!path) return;
  const pts = path.getAttribute("d").split(/[ML]/).filter(Boolean).map((p) => p.split(",").map(Number));
  fs.forEach((r, i) => {
    if (r.status === "clear" || !pts[i]) return;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", pts[i][0]); c.setAttribute("cy", pts[i][1]); c.setAttribute("r", 5);
    c.setAttribute("fill", r.status === "red" ? css("--critical") : css("--warning"));
    c.setAttribute("stroke", css("--surface")); c.setAttribute("stroke-width", 2);
    svg.insertBefore(c, svg.querySelector("line.cross"));
  });
}

function headline(d) {
  const s = d.stats;
  if (s.night - s.midday > 15) return `Cheap at noon, expensive after dark: ${esc(d.month_label)} averaged ${rs(s.mean)}/kWh, but nights ran ${s.night.toFixed(0)} against ${s.midday.toFixed(0)} at midday.`;
  return `${esc(d.month_label)} averaged ${rs(s.mean)}/kWh, with ${s.n_ext} hours at Rs ${EXT} or more.`;
}

// ============================================================== FORECAST
async function forecast() {
  const d = await get("/api/forecast");
  const L = d.labels, LM = d.live_model;
  if (!d.live) { view.innerHTML = "<h1>No forecasts yet</h1><p>Run <code>python -m pipeline.forecast.run all</code>.</p>"; return; }
  const day = d.live.day[LM.day_ahead] || [], pers = d.live.day.persistence || [];
  const nExp = day.filter((r) => r.q50 >= EXT).length, nPos = day.filter((r) => r.q90 >= EXT).length;
  const met = d.metrics || [];
  const M = (h, m, period) => met.find((r) => r.horizon === h && r.model === m && r.period.startsWith(period));
  const dg = M("day_ahead", "gbm_ratio", "test ("), dp = M("day_ahead", "persistence", "test ("), dl = M("day_ahead", LM.day_ahead, "test (");
  const nq = M("next_month", "quarter_profile", "test ("), ni = M("next_month", "ismo_ctbcm_raw", "test (");
  const better = (a, b) => Math.round((1 - a / b) * 100);
  view.innerHTML = `
    <p class="eyebrow">Forecasts · data through ${new Date(d.live.data_through).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
    <h1>${day.length ? `${fmt.day(day[0].ts)}: ${nExp} hour${nExp === 1 ? "" : "s"} expected at Rs ${EXT}+, ${nPos} possible.` : "Forecasts"}</h1>
    ${dg && dp && nq && ni ? `<p class="dek">In the 2026 test, on ${dg.n_hours.toLocaleString()} hours never used to choose anything: next month's forecast was ${better(nq.mae, ni.mae)}% more accurate than ISMO's own CTBCM projection, and tomorrow's forecast cut the large misses of "same as yesterday" by ${better(dg.rmse, dp.rmse)}%, though its average error was no better.</p>` : ""}

    <h2>Tomorrow, hour by hour</h2>
    <p class="sub">Median forecast with its 80% range, against the simplest possible forecast: yesterday's price for the same hour. Assumes daily access to prices, as a market participant has; ISMO's public file arrives monthly.</p>
    <div id="c-day"></div>

    <h2>The next two months</h2>
    <p class="sub">ISMO publishes each month's prices two to five weeks after it ends, so a forecast for month T can only use prices up to the end of T−2. This is what anyone can do with public data.</p>
    <div class="cols">
      <div id="c-nm"></div>
      <div><table><tr><th>Month</th><th class="n">Average</th><th class="n">80% range</th><th>Uses prices to</th></tr>
      ${d.live.months.map((r) => `<tr><td>${fmt.month(r.m + "-01")}</td><td class="n">${rs(r.q50)}</td><td class="n">${r.q10.toFixed(1)}–${r.q90.toFixed(1)}</td><td>${fmt.month(new Date(new Date(r.origin) - 864e5))}</td></tr>`).join("")}</table>
      <p class="cap">Model: the same-hour average of the last three published months, with a range from its own past errors, chosen on Jul–Dec 2025 before any 2026 result was seen.</p></div>
    </div>

    <h2>How well does it work?</h2>
    <p class="sub">Walk-forward: each forecast used only data that existed at the time, and the models were retrained as time moved on. Jul–Dec 2025 was used to choose the models; Jan 2026 onward is the clean test, oil shock included.</p>
    ${metricsTable(d, L)}
    <div class="cols even">
      <div><h3>Day ahead: average error by month</h3><div id="c-mae-d"></div></div>
      <div><h3>Next month: average error by month</h3><div id="c-mae-n"></div></div>
    </div>
    <p class="cap">Rs/kWh. Every model's error jumped with the April 2026 oil shock. ISMO's projection, built on September 2025 inputs, is compared at the monthly horizon, where it belongs; in the calm months of early 2026 it was the more accurate of the two.</p>

    <h3>Look inside any month</h3>
    <div class="filters">
      <select id="bt-h"><option value="day_ahead">Day ahead</option><option value="next_month">Next month</option></select>
      <select id="bt-m">${(d.backtest_months || []).slice().reverse().map((m) => `<option>${m}</option>`).join("")}</select>
    </div>
    <div id="c-bt"></div>

    <h2>Warning of Rs ${EXT}+ hours</h2>
    <p class="sub">Which method best flags tomorrow's extreme hours? All were run walk-forward on the same hours.</p>
    ${extremeTable(d.extreme)}
    <p class="note" style="max-width:52em">Hour by hour, nothing beats "it was above Rs ${EXT} yesterday" by much: these hours are oil-fired plants setting the evening price, and that repeats day to day. A dedicated classifier added nothing over the price forecast, so the product uses the forecast's bands. The warning that matters comes earlier, from fuel markets: see the fuel-shock monitor on the Market page.</p>`;

  if (day.length) {
    lineChart($("#c-day"), {
      x: day.map((r) => new Date(r.ts).getHours()),
      series: [{ name: "Median forecast", short: "Forecast", values: day.map((r) => r.q50), color: css("--series-1"), width: 2.5 },
               { name: "Same hour yesterday", short: "Yesterday", values: pers.map((r) => r.q50), color: css("--ink-3"), dash: "4 3", width: 1.5 }],
      band: { lo: day.map((r) => r.q10), hi: day.map((r) => r.q90), color: css("--series-1"), name: "80% range" },
      xTicks: [0, 3, 6, 9, 12, 15, 18, 21], xTick: fmt.hour, tipX: (h) => fmt.hour(h), yFmt: (v) => v.toFixed(0),
      ref: { y: EXT, label: "Rs " + EXT }, height: 290,
    });
  }
  const mps = d.live.month_profiles, keys = Object.keys(mps);
  const colors = [css("--series-1"), css("--series-2")];
  lineChart($("#c-nm"), {
    x: H24, series: keys.map((k, i) => ({ name: fmt.month(k + "-01"), values: mps[k].map((r) => r.q50), color: colors[i] })),
    band: { lo: mps[keys[keys.length - 1]].map((r) => r.q10), hi: mps[keys[keys.length - 1]].map((r) => r.q90), color: colors[keys.length - 1], name: "80% range, " + fmt.month(keys[keys.length - 1] + "-01") },
    xTicks: [0, 6, 12, 18], xTick: fmt.hour, tipX: fmt.hour, yFmt: (v) => v.toFixed(0), ref: { y: EXT, label: "Rs " + EXT }, height: 260,
  });
  const mon = d.monthly || [];
  const months = [...new Set(mon.map((r) => r.period))].sort();
  const pick = (h, model) => months.map((m) => { const r = mon.find((x) => x.period === m && x.model === model && x.horizon === h); return r ? r.mae : null; });
  const maeChart = (host, h, series) => lineChart(host, {
    x: months.map((m) => m + "-01"), xType: "time", series,
    xTicks: months.filter((m, i) => i % 3 === 0).map((m) => m + "-01"), xTick: fmt.month, tipX: fmt.month,
    yFmt: (v) => v.toFixed(0), height: 230, rightPad: 64,
  });
  maeChart($("#c-mae-d"), "day_ahead", [
    { name: L.persistence, short: "Yesterday", values: pick("day_ahead", "persistence"), color: css("--ink-3"), dash: "4 3", width: 1.5 },
    { name: L.gbm_ratio, short: "Pre-reg.", values: pick("day_ahead", "gbm_ratio"), color: css("--series-7"), width: 1.5 },
    { name: L.blend, short: "Live", values: pick("day_ahead", "blend"), color: css("--series-1"), width: 2.5 }]);
  maeChart($("#c-mae-n"), "next_month", [
    { name: L.ismo_ctbcm_raw, short: "ISMO", values: pick("next_month", "ismo_ctbcm_raw"), color: css("--series-2") },
    { name: "Same hour, last known month", short: "Last month", values: pick("next_month", "persistence"), color: css("--ink-3"), dash: "4 3", width: 1.5 },
    { name: L.quarter_profile, short: "Ours", values: pick("next_month", "quarter_profile"), color: css("--series-1"), width: 2.5 }]);
  const drawBt = async () => {
    if (!$("#bt-h")) return;
    const h = $("#bt-h").value, m = $("#bt-m").value;
    try {
      const b = await get(`/api/backtest?month=${m}&horizon=${h}`);
      const live = b.models[LM[h]] || [], ismo = b.models.ismo_ctbcm_raw || [];
      const ix = new Map(ismo.map((r) => [r.ts, r.q50]));
      const series = [{ name: "Published price", short: "Actual", values: b.actual.map((r) => r.actual), color: css("--ink"), width: 1.25 },
                      { name: L[LM[h]], short: "Ours", values: live.map((r) => r.q50), color: css("--series-1"), width: 1.75 }];
      if (ismo.length) series.push({ name: L.ismo_ctbcm_raw, short: "ISMO", values: b.actual.map((r) => ix.get(r.ts) ?? null), color: css("--series-2"), width: 1.25 });
      lineChart($("#c-bt"), {
        x: b.actual.map((r) => r.ts), xType: "time", series,
        band: { lo: live.map((r) => r.q10), hi: live.map((r) => r.q90), color: css("--series-1"), name: "Our 80% range" },
        xTicks: b.actual.filter((r) => new Date(r.ts).getHours() === 0 && new Date(r.ts).getDate() % 5 === 1).map((r) => r.ts),
        xTick: fmt.day, tipX: fmt.dayhour, yFmt: (v) => v.toFixed(0), height: 300, ref: { y: EXT, label: "Rs " + EXT },
      });
    } catch (e) { $("#c-bt").innerHTML = `<p class="muted">No forecasts for that month.</p>`; }
  };
  $("#bt-h").addEventListener("change", drawBt); $("#bt-m").addEventListener("change", drawBt);
  if ((d.backtest_months || []).length) drawBt();
}

function metricsTable(d, L) {
  const met = d.metrics || [];
  if (!met.length) return `<p class="muted">Backtest results will appear once the backtest has run.</p>`;
  const rows = [["day_ahead", "gbm_ratio"], ["day_ahead", "blend"], ["day_ahead", "persistence"],
                ["next_month", "quarter_profile"], ["next_month", "persistence"], ["next_month", "ismo_ctbcm_raw"]];
  const per = (h, m, p) => met.find((r) => r.horizon === h && r.model === m && r.period.startsWith(p));
  const cell = (r) => (r ? rs(r.mae, 2) : "–");
  return `<table><tr><th>Model</th><th>Horizon</th><th class="n">Validation<br>Jul–Dec 2025</th><th class="n">Test<br>Jan–Aug 2026</th><th class="n">Test, calm<br>Jan–Mar</th><th class="n">Test, shock<br>Apr–Aug</th><th class="n">Large misses<br>(RMSE, test)</th><th class="n">80% range held<br>(test)</th></tr>
  ${rows.map(([h, m]) => { const t = per(h, m, "test ("); if (!t) return "";
    return `<tr class="${m === d.live_model[h] ? "hl" : ""}"><td>${esc(L[m] || m)}</td><td>${m.startsWith("ismo") ? "projection" : h.replace("_", " ")}</td>
    <td class="n">${cell(per(h, m, "validation"))}</td><td class="n"><b>${cell(t)}</b></td><td class="n">${cell(per(h, m, "test, calm"))}</td><td class="n">${cell(per(h, m, "test, oil"))}</td>
    <td class="n">${t.rmse == null ? "–" : t.rmse.toFixed(2)}</td><td class="n">${t.coverage_80 == null ? "–" : pct(t.coverage_80)}</td></tr>`; }).join("")}</table>
  <p class="cap">Average error: mean absolute difference from the published price, Rs/kWh per hour. Highlighted: what the site serves. The pre-registered day-ahead model did not beat "same as yesterday" on average error in the test, though it cut large misses; the blend did beat it, but was chosen after seeing the test, so its real record starts with the live forecasts from September 2026. An honest 80% range holds about 80% of the time; ours held less in the oil shock, which we report rather than tune away.</p>`;
}

function extremeTable(e) {
  if (!e || !e.length) return `<p class="muted">Available after the backtest runs.</p>`;
  const names = { classifier: "Dedicated classifier", rule_yesterday: "Above Rs 50 yesterday, same hour", rule_week: "Above Rs 50 any day this week, same hour",
    forecast_q50: "Price forecast median above Rs 50", forecast_q90: "Price forecast upper band above Rs 50", ismo_ctbcm_raw: "ISMO CTBCM projection above Rs 50" };
  return `<table><tr><th>Method</th><th class="n">Caught</th><th class="n">Missed</th><th class="n">False alarms</th><th class="n">Share caught</th><th class="n">Alerts that were right</th></tr>
  ${e.map((r) => `<tr><td>${esc(names[r.method] || r.method)}</td><td class="n">${r.caught}</td><td class="n">${r.missed}</td><td class="n">${r.false_alarms}</td><td class="n">${pct(r.recall)}</td><td class="n">${pct(r.precision)}</td></tr>`).join("")}</table>`;
}

// ============================================================ CALCULATOR
async function calculator() {
  const ctx = await get("/api/ctbcm/context");
  view.innerHTML = `
    <p class="eyebrow">CTBCM open access · for bulk power consumers</p>
    <h1>Should this factory leave its DISCO and buy power in the market?</h1>
    <p class="dek">Prices your load hour by hour against the real market price (or ISMO's projection), with NEPRA's final grid charges of 7 September 2026. ISMO's own model answers this from the supplier's side; this answers it from yours.</p>
    <div class="calc">
      <form class="inputs" id="f">
        ${seg("category", "Connection", [["B-3", "B-3 · 11 kV"], ["B-4", "B-4 · 132 kV"]], "B-3")}
        <div class="field"><label for="mdi">Maximum demand, kW</label><input type="number" id="mdi" name="max_demand_kw" value="5000" min="100" step="100"></div>
        <div class="field"><label for="shape">How the plant runs</label><select id="shape" name="shape">
          ${Object.entries(ctx.shapes).map(([k, v]) => `<option value="${k}">${esc(v.split(" (")[0])}</option>`).join("")}</select>
          <div class="hint" id="shape-hint"></div></div>
        ${seg("route", "Route to open access", [["auction", "Via auction"], ["outside_auction", "Outside it"]], "auction")}
        <div class="field"><label for="kind">How power is bought</label><select id="kind" name="kind">
          <option value="market">At the hourly market price</option><option value="fixed_price">Fixed-price contract</option>
          <option value="solar_plus_market">Solar contract + market for the rest</option></select></div>
        <div class="field cond" data-for="market"><label for="margin">Supplier margin, Rs/kWh</label><input type="number" id="margin" name="supplier_margin" value="1" step="0.1" min="0"></div>
        <div class="field cond" data-for="fixed_price"><label for="cp">Contract price at the generator, Rs/kWh</label><input type="number" id="cp" name="contract_price" value="18" step="0.5" min="0"></div>
        <div class="field cond" data-for="solar_plus_market"><label for="smw">Contracted solar, MW</label><input type="number" id="smw" name="solar_mw" value="5" step="0.5" min="0"></div>
        <div class="field cond" data-for="solar_plus_market"><label for="sp">Solar price, Rs/kWh</label><input type="number" id="sp" name="solar_price" value="14" step="0.5" min="0"></div>
        <div class="field"><label for="scn">Price scenario for the breakdown</label><select id="scn" name="scenario">
          ${ctx.scenarios.map((s) => `<option value="${s.key}" ${s.key === "last12" ? "selected" : ""}>${esc(s.description)}</option>`).join("")}</select></div>
        <div class="field"><label for="fpa">Grid tariff adjustments (FPA + QTA), Rs/kWh</label><input type="number" id="fpa" name="fpa_qta" value="0" step="0.1">
          <div class="hint">Changes monthly; ISMO's model used −3.68 for Sep 2025.</div></div>
      </form>
      <div id="out"><p class="muted">Calculating…</p></div>
    </div>

    <h2>The market for open access</h2>
    ${bpcBlock(ctx)}
    <h2>Assumptions, and where each comes from</h2>
    <table><tr><th>Item</th><th>Value</th><th>Source</th></tr>${ctx.assumptions.map((a) => `<tr><td>${esc(a.item)}</td><td>${esc(a.value)}</td><td class="note">${esc(a.source)}</td></tr>`).join("")}</table>
    <h3>Grid charges (NEPRA, 7 Sep 2026), Rs/kWh</h3>
    <table><tr><th>Category</th><th>Route</th><th class="n">Transmission</th><th class="n">Distribution</th><th class="n">Cross-subsidy</th><th class="n">Stranded cost</th><th class="n">Total</th></tr>
    ${ctx.grid_charges.filter((g) => g.tariff_category.startsWith("B")).map((g) => `<tr><td>${g.tariff_category}</td><td>${g.variant === "auction" ? "Via auction" : "Outside auction"}</td><td class="n">${g.transmission_rs_kwh.toFixed(2)}</td><td class="n">${g.distribution_rs_kwh.toFixed(2)}</td><td class="n">${g.cross_subsidy_rs_kwh.toFixed(2)}</td><td class="n">${g.stranded_rs_kwh.toFixed(2)}</td><td class="n"><b>${g.total_variable_rs_kwh.toFixed(2)}</b></td></tr>`).join("")}</table>
    <h3>Not included</h3><ul class="note">${ctx.not_included.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

  const f = $("#f");
  const sync = () => {
    const k = f.kind.value;
    document.querySelectorAll(".cond").forEach((c) => c.classList.toggle("show", c.dataset.for === k));
    $("#shape-hint").textContent = ctx.shapes[f.shape.value];
  };
  let t;
  f.addEventListener("input", () => { sync(); clearTimeout(t); t = setTimeout(run, 250); });
  sync(); run();

  async function run() {
    const body = Object.fromEntries(new FormData(f).entries());
    for (const k of ["max_demand_kw", "supplier_margin", "contract_price", "solar_mw", "solar_price", "fpa_qta"]) body[k] = parseFloat(body[k] || 0);
    let res;
    try { res = await ctbcmCompute(body); } catch (e) { if ($("#out")) $("#out").innerHTML = `<p class="neg">Check the inputs (${esc(e.message)}).</p>`; return; }
    renderCalc(res, body);
  }
}

function seg(name, label, opts, val) {
  return `<div class="field"><label>${label}</label><div class="seg">${opts.map(([v, l]) =>
    `<label><input type="radio" name="${name}" value="${v}" ${v === val ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>`;
}

function renderCalc(r, inp) {
  if (!$("#out")) return;
  const res = r.result, save = res.saving_rs_kwh, be = res.breakeven;
  const verdict = save >= 0
    ? `Open access saves about <span class="pos">${rs(save, 2)}/kWh</span>, roughly Rs ${(res.saving_rs_per_year / 1e6).toFixed(0)} million a year.`
    : `Open access costs <span class="neg">${rs(-save, 2)}/kWh more</span> than staying on the grid, about Rs ${(-res.saving_rs_per_year / 1e6).toFixed(0)} million a year.`;
  const beTxt = {
    "max supplier margin (Rs/kWh)": (v) => v >= 0 ? `It breaks even as long as the supplier's margin stays under <b>${rs(v, 2)}/kWh</b>.` : `Even with a supplier margin of zero, open access would cost ${rs(-v, 2)}/kWh more than the grid.`,
    "max contract price at the generator (Rs/kWh)": (v) => `The most a supplier can charge at the plant for this to break even: <b>${rs(v, 2)}/kWh</b>.`,
    "max solar price (Rs/kWh)": (v) => v > 0 ? `The solar contract breaks even up to <b>${rs(v, 2)}/kWh</b> of solar energy.` : `No solar price makes this pay: the expensive hours are at night, when solar is not there.`,
  }[be.term](be.value);
  const all = r.regulated.filter((x) => x.component !== "total").map((x) => ({ ...x, side: "reg" }))
    .concat(r.open_access.filter((x) => x.component !== "total").map((x) => ({ ...x, side: "oa" })));
  const max = Math.max(...all.map((x) => Math.abs(x.rs_per_kwh)));
  const bars = (rows, o) => rows.filter((x) => x.component !== "total").map((x) => `<tr><td>${esc(x.component)}</td><td class="n">${x.rs_per_kwh.toFixed(2)}</td>
    <td style="width:38%"><span class="bar ${o ? "o" : ""}" style="width:${Math.abs(x.rs_per_kwh) / max * 100}%;${x.rs_per_kwh < 0 ? "opacity:.45" : ""}"></span></td></tr>`).join("");
  const tot = (rows) => rows.find((x) => x.component === "total").rs_per_kwh;
  const sc = r.scenarios;
  const ex = r.exit;
  $("#out").innerHTML = `
    <p class="eyebrow">${esc(r.selected_description)}</p>
    <p class="verdict">${verdict}</p>
    <p>${beTxt}</p>
    <h3>Under every price scenario</h3>
    <div id="c-scn"></div>
    <table><tr><th>Scenario</th><th class="n">Market avg</th><th class="n">Grid tariff</th><th class="n">Open access</th><th class="n">Saving</th><th class="n">Break-even</th></tr>
    ${sc.map((s) => `<tr class="${s.scenario === r.selected ? "hl" : ""}"><td>${esc(s.description)}</td><td class="n">${s.mean_smp.toFixed(1)}</td><td class="n">${s.regulated_rs_kwh.toFixed(2)}</td><td class="n">${s.open_access_rs_kwh.toFixed(2)}</td>
      <td class="n ${s.saving_rs_kwh >= 0 ? "pos" : "neg"}">${s.saving_rs_kwh >= 0 ? "+" : "−"}${Math.abs(s.saving_rs_kwh).toFixed(2)}</td><td class="n">${s.breakeven_value == null ? "–" : s.breakeven_value.toFixed(2)}</td></tr>`).join("")}</table>
    <p class="cap">Rs/kWh of the factory's consumption. Break-even is the contract term above (margin, contract price or solar price) at which both routes cost the same.</p>
    <h3>Where each rupee goes, ${esc(r.selected_description.split(" (")[0])}</h3>
    <table><tr><th colspan="3">Staying on the DISCO tariff · ${tot(r.regulated).toFixed(2)}</th></tr>${bars(r.regulated, false)}</table>
    <table style="margin-top:10px"><tr><th colspan="3">Open access · ${tot(r.open_access).toFixed(2)}</th></tr>${bars(r.open_access, true)}</table>
    <p class="cap">Energy is grossed up for ${pct(r.loss, 1)} network losses. Load factor ${pct(res.load_factor)}. Excludes sales tax and duty, which apply either way.</p>
    <h3>If this factory leaves: the DISCO's side</h3>
    <table>
      <tr><td>Tariff revenue the DISCO loses</td><td class="n">${ex.tariff_revenue_rs_kwh.toFixed(2)}</td></tr>
      <tr><td>Kept as grid charges</td><td class="n">−${ex.kept_as_grid_charges_rs_kwh.toFixed(2)}</td></tr>
      <tr><td>Power the system no longer has to generate, at the marginal price</td><td class="n">−${ex.avoided_energy_rs_kwh.toFixed(2)}</td></tr>
      <tr class="hl"><td><b>${ex.shifted_to_others_rs_kwh >= 0 ? "Left for remaining consumers to carry" : "Net saving to the system"}</b></td><td class="n"><b>${Math.abs(ex.shifted_to_others_rs_kwh).toFixed(2)}</b></td></tr>
    </table>
    <p class="cap">Rs/kWh of the departing load, ${(ex.kwh_per_year / 1e6).toFixed(0)} GWh a year. What is left over is mostly capacity payments, which do not go away when a consumer does. When the marginal plant is oil-fired, the power a departure avoids can be worth more than the tariff it takes away.</p>`;
  barChart($("#c-scn"), {
    labels: sc.map((s) => s.scenario), values: sc.map((s) => s.saving_rs_kwh),
    colors: sc.map((s) => (s.saving_rs_kwh >= 0 ? css("--series-3") : css("--series-2"))), height: 190,
    xTick: (l) => ({ fy2025: "FY25", fy2026: "FY26", last12: "Last 12m", shock: "Oil shock", ismo_fy2027: "ISMO FY27" }[l] || l),
    yFmt: (v) => v.toFixed(0), tip: (i) => `<b>${esc(sc[i].description)}</b><div>${sc[i].saving_rs_kwh >= 0 ? "Saves" : "Costs"} ${rs(Math.abs(sc[i].saving_rs_kwh), 2)}/kWh ${sc[i].saving_rs_kwh >= 0 ? "" : "more"}</div>`,
  });
}

function bpcBlock(ctx) {
  const b = ctx.bpc || [];
  if (!b.length) return "";
  const tot = b.reduce((a, r) => a + r.mw, 0), n = b.reduce((a, r) => a + r.n, 0);
  const b3 = b.find((r) => r.tariff_category === "B-3") || { n: 0, mw: 0 }, b4 = b.find((r) => r.tariff_category === "B-4") || { n: 0, mw: 0 };
  return `<p class="sub">ISMO's list of bulk consumers has ${n.toLocaleString()} entries with ${(tot / 1000).toFixed(1)} GW of sanctioned load. Industrial B-3 and B-4 connections alone are ${(b3.n + b4.n).toLocaleString()} consumers and ${((b3.mw + b4.mw) / 1000).toFixed(1)} GW; the first wheeling auction offers 800 MW. Totals only: the source list's names and contact details are never stored.</p>
  <table><tr><th>Category</th><th class="n">Consumers</th><th class="n">Sanctioned MW</th><th class="n">With net metering</th></tr>
  ${b.slice(0, 8).map((r) => `<tr><td>${r.tariff_category}</td><td class="n">${r.n.toLocaleString()}</td><td class="n">${Math.round(r.mw).toLocaleString()}</td><td class="n">${r.n_nm}</td></tr>`).join("")}</table>`;
}

// =============================================================== QUALITY
async function quality() {
  const d = await get("/api/quality");
  const c = d.counts;
  const official = d.issues.filter((i) => i.severity === "critical" && !i.dataset.includes("ke_internal")).length;
  view.innerHTML = `
    <p class="eyebrow">Data quality · run ${d.run_id}</p>
    <h1>${official} critical problems in ISMO's published data, found automatically.</h1>
    <p class="dek">Every rebuild checks the source files for gaps, impossible values, silent revisions, misfiled months and stale sheets, and records what it found. Anyone relying on ISMO's website directly would not know.</p>
    <div class="figs">
      <div class="fig"><div class="l">Critical</div><div class="v">${c.critical || 0}</div></div>
      <div class="fig"><div class="l">Warnings</div><div class="v">${c.warning || 0}</div></div>
      <div class="fig"><div class="l">Checks passed</div><div class="v">${c.info || 0}</div></div>
      <div class="fig"><div class="l">Rows in the warehouse</div><div class="v">${(d.tables.reduce((a, t) => a + t.rows, 0) / 1e6).toFixed(2)}m</div></div>
    </div>
    <div class="filters"><select id="sev"><option value="">All severities</option><option>critical</option><option>warning</option><option>info</option></select></div>
    <table id="iss"></table>
    <p class="note"><a href="reports/data_quality_latest.html" target="_blank" rel="noopener">Full data-quality report</a>, including coverage by month.</p>
    <h2>Every source file</h2>
    <p class="sub">${d.sources.length} files, each with its SHA-256 checksum. Every row in the warehouse carries the id of the file it came from.</p>
    <table><tr><th>File</th><th>Source</th><th>Published</th><th>SHA-256</th></tr>
    ${d.sources.map((s) => `<tr><td>${esc(s.title)}</td><td class="note">${esc(s.source.split(":")[0])}</td><td>${s.published_on ? fmt.day(s.published_on) + " " + new Date(s.published_on).getFullYear() : ""}</td><td><code>${esc((s.sha256 || "").slice(0, 12))}</code></td></tr>`).join("")}</table>`;
  const draw = () => {
    const sv = $("#sev").value;
    const rows = d.issues.filter((i) => !sv || i.severity === sv);
    $("#iss").innerHTML = `<tr><th>Severity</th><th>Check</th><th>Dataset</th><th>Finding</th></tr>` + rows.map((i) =>
      `<tr><td><span class="pill ${i.severity}">${i.severity === "info" ? "passed" : i.severity}</span></td><td>${esc(i.check_name.replace(/_/g, " "))}</td><td class="note">${esc(i.dataset.replace(/_/g, " "))}</td><td>${esc(i.detail)}</td></tr>`).join("");
  };
  $("#sev").addEventListener("change", draw); draw();
}

// ================================================================ BRIEFS
async function briefs() {
  const d = await get("/api/briefs");
  view.innerHTML = `
    <p class="eyebrow">Monthly briefs</p>
    <h1>A market brief, written by the pipeline every month.</h1>
    <p class="dek">When ISMO publishes a month, the system rebuilds, re-forecasts and writes the brief: what happened, why, what comes next, and what it means for bulk consumers. No number in it is typed by hand.</p>
    <ul class="briefs">${d.briefs.map((b) => `<li><a href="reports/${b.html}" target="_blank" rel="noopener">${esc(b.month)}</a>
      <span>${b.pdf ? `<a class="note" href="reports/${b.pdf}" target="_blank" rel="noopener">PDF</a>` : ""}</span></li>`).join("") || "<li class='muted'>No briefs yet.</li>"}</ul>`;
}

// ================================================================ METHOD
async function method() {
  view.innerHTML = `
    <p class="eyebrow">Method</p>
    <h1>How GridSight works, and what it can't do.</h1>
    <ol class="steps">
      <li><b>Collect.</b> Scripts download ISMO's full archive through the same interface its website uses, plus CPPA-G's monthly energy purchases, NEPRA's grid-charge decision, World Bank fuel prices and hourly weather for twelve load centres. Every file is logged with its checksum.</li>
      <li><b>Build.</b> A DuckDB warehouse (star schema, times in Pakistan Standard Time, hour-beginning) keeps every published version of the price, so any revision is visible. Rebuild takes about two minutes.</li>
      <li><b>Check.</b> Automated checks for completeness, impossible values, silent revisions, generation vs demand, misfiled and stale workbooks, and freshness, with a report every run.</li>
      <li><b>Forecast.</b> Day-ahead (gradient-boosted quantile regression, retrained weekly) and next-month (three-month profile). Settings were fixed on Jul–Dec 2025 before any 2026 result was seen, and every test is walk-forward.</li>
      <li><b>Decide.</b> The open-access calculator prices a consumer's load hour by hour under NEPRA's grid charges and ISMO's own CTBCM assumptions.</li>
      <li><b>Report.</b> A monthly brief, written from the warehouse, as HTML and PDF.</li>
    </ol>
    <h2>Limits worth knowing</h2>
    <ul style="max-width:52em">
      <li>Two years of hourly prices, with one regime change (April 2026). Ranges were too narrow during the shock; they are reported as they are.</li>
      <li>The day-ahead forecast assumes daily price access (as a market participant has). The public file arrives monthly.</li>
      <li>Weather at the forecast hour uses observed values in testing, standing in for a next-day weather forecast.</li>
      <li>The capacity price in the calculator is ISMO's planning value; the market price for capacity has not yet been discovered.</li>
      <li>Hourly demand is published only for FY2025, so it is not used as a forecast input.</li>
    </ul>`;
}

route();
