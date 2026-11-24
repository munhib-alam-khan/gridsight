(function () {
// Small SVG chart kit: line (with range band), bar, heatmap. Every chart has a hover
// layer. Colours come from CSS custom properties so light and dark themes both work.
const NS = "http://www.w3.org/2000/svg";
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function niceTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

function tooltip(host) {
  let t = host.querySelector(".tip");
  if (!t) { t = document.createElement("div"); t.className = "tip"; host.appendChild(t); }
  return {
    show(html, x, y) {
      t.innerHTML = html; t.style.display = "block";
      const w = t.offsetWidth, hw = host.clientWidth;
      t.style.left = Math.min(Math.max(x + 14, 0), hw - w - 4) + "px";
      t.style.top = Math.max(y - 10, 0) + "px";
    },
    hide() { t.style.display = "none"; },
  };
}

const fmt = {
  rs: (v) => (v == null ? "–" : "Rs " + v.toFixed(1)),
  num: (v, d = 1) => (v == null ? "–" : v.toFixed(d)),
  hour: (h) => String(h).padStart(2, "0") + ":00",
  month: (d) => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
  day: (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  dayhour: (d) => { const x = new Date(d); return x.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + String(x.getHours()).padStart(2, "0") + ":00"; },
};

// opts: {x:[...], xType:'num'|'time', series:[{name, values, color, dash, width, label}],
//        band:{lo, hi, color, name}, yLabel, xTick:(v)=>str, xTicks:[...], tipX:(v)=>str,
//        yFmt, ref:{y,label}, height, yMin, yMax}
function lineChart(host, o) {
  host.innerHTML = ""; host.classList.add("chart");
  const W = Math.max(host.clientWidth, 300), H = o.height || 260;
  const m = { t: 14, r: o.rightPad ?? 70, b: 30, l: 46 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" }, host);
  if (o.title) el("title", {}, svg).textContent = o.title;
  const xs = o.x.map((v) => (o.xType === "time" ? new Date(v).getTime() : v));
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let all = [];
  o.series.forEach((s) => all.push(...s.values.filter((v) => v != null)));
  if (o.band) { all.push(...o.band.lo.filter((v) => v != null), ...o.band.hi.filter((v) => v != null)); }
  if (o.ref) all.push(o.ref.y);
  const yt = niceTicks(o.yMin ?? Math.min(0, ...all), o.yMax ?? Math.max(...all));
  const ymin = yt[0], ymax = yt[yt.length - 1];
  const X = (v) => m.l + ((v - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
  const g = el("g", {}, svg);
  yt.forEach((v) => {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }, g);
    el("text", { x: m.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, g).textContent = o.yFmt ? o.yFmt(v) : v;
  });
  if (o.yLabel) el("text", { x: 4, y: m.t - 2, class: "tick" }, g).textContent = "";
  let xticks = o.xTicks || niceTicks(xmin, xmax, 6).filter((v) => v >= xmin && v <= xmax);
  const room = (W - m.l - m.r) / 52;                 // keep labels at least ~52px apart
  if (xticks.length > room) { const k = Math.ceil(xticks.length / room); xticks = xticks.filter((_, i) => i % k === 0); }
  xticks.forEach((v) => {
    const xv = o.xType === "time" ? new Date(v).getTime() : v;
    el("text", { x: X(xv), y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, g).textContent = o.xTick ? o.xTick(v) : v;
  });
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, g);
  if (o.ref) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(o.ref.y), y2: Y(o.ref.y), class: "ref" }, g);
    el("text", { x: m.l + 4, y: Y(o.ref.y) - 4, class: "reflabel" }, g).textContent = o.ref.label;
  }
  if (o.band) {
    let d = "";
    xs.forEach((x, i) => { if (o.band.hi[i] != null) d += (d ? "L" : "M") + X(x) + "," + Y(o.band.hi[i]); });
    for (let i = xs.length - 1; i >= 0; i--) if (o.band.lo[i] != null) d += "L" + X(xs[i]) + "," + Y(o.band.lo[i]);
    el("path", { d: d + "Z", fill: o.band.color || css("--series-1"), opacity: 0.16 }, g);
  }
  const labels = [];
  o.series.forEach((s) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? "L" : "M") + X(xs[i]) + "," + Y(v); pen = true;
    });
    el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-dasharray": s.dash || "",
      "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
    if (s.label !== false) {   // direct label at the last point (placed after collision pass)
      let i = s.values.length - 1; while (i > 0 && s.values[i] == null) i--;
      labels.push({ x: X(xs[i]) + 6, y: Y(s.values[i]) + 4, text: s.short || s.name });
    }
  });
  labels.sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 13) labels[k].y = labels[k - 1].y + 13;
  labels.forEach((l) => { el("text", { x: l.x, y: l.y, class: "dlabel" }, g).textContent = l.text; });
  // hover
  const tip = tooltip(host);
  const cross = el("line", { y1: m.t, y2: H - m.b, class: "cross", visibility: "hidden" }, svg);
  const dots = o.series.map((s) => el("circle", { r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(X(x) - px); if (d < bd) { bd = d; best = i; } });
    cross.setAttribute("x1", X(xs[best])); cross.setAttribute("x2", X(xs[best])); cross.setAttribute("visibility", "visible");
    let html = `<b>${o.tipX ? o.tipX(o.x[best]) : o.x[best]}</b>`;
    o.series.forEach((s, k) => {
      const v = s.values[best];
      if (v == null) { dots[k].setAttribute("visibility", "hidden"); return; }
      dots[k].setAttribute("cx", X(xs[best])); dots[k].setAttribute("cy", Y(v)); dots[k].setAttribute("visibility", "visible");
      html += `<div><i style="background:${s.color}"></i>${s.name}: ${o.yFmt ? o.yFmt(v) : fmt.num(v)}</div>`;
    });
    if (o.band && o.band.lo[best] != null) html += `<div class="muted">${o.band.name || "80% range"}: ${fmt.num(o.band.lo[best])} – ${fmt.num(o.band.hi[best])}</div>`;
    tip.show(html, ((ev.clientX - r.left)), ev.clientY - r.top);
  });
  hit.addEventListener("mouseleave", () => { tip.hide(); cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); });
  if (o.legend !== false && o.series.length > 1) legend(host, o.series.map((s) => ({ name: s.name, color: s.color, dash: s.dash })).concat(o.band ? [{ name: o.band.name || "80% range", color: o.band.color || css("--series-1"), band: true }] : []));
}

function legend(host, items) {
  const l = document.createElement("div"); l.className = "legend";
  items.forEach((it) => {
    const s = document.createElement("span");
    s.innerHTML = it.band ? `<i class="band" style="background:${it.color}"></i>${it.name}`
      : `<i class="${it.dash ? "dash" : ""}" style="${it.dash ? "border-color" : "background"}:${it.color}"></i>${it.name}`;
    l.appendChild(s);
  });
  host.insertBefore(l, host.firstChild);
}

// opts: {labels:[...], values:[...], colors:[...]|color, yFmt, tip:(i)=>html, height, zero:true, xTick}
function barChart(host, o) {
  host.innerHTML = ""; host.classList.add("chart");
  const W = Math.max(host.clientWidth, 300), H = o.height || 220;
  const m = { t: 12, r: 12, b: 30, l: 46 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" }, host);
  const vals = o.values.map((v) => v ?? 0);
  const yt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const ymin = yt[0], ymax = yt[yt.length - 1];
  const Y = (v) => H - m.b - ((v - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
  const n = vals.length, bw = (W - m.l - m.r) / n, gap = Math.min(2 + bw * 0.25, 12);
  yt.forEach((v) => {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? "axis" : "grid" }, svg);
    el("text", { x: m.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = o.yFmt ? o.yFmt(v) : v;
  });
  const tip = tooltip(host);
  const every = Math.ceil(n / Math.floor((W - m.l) / 46));
  vals.forEach((v, i) => {
    const x = m.l + i * bw + gap / 2, y0 = Y(0), y1 = Y(v);
    const h = Math.max(Math.abs(y1 - y0), v === 0 ? 0 : 1);
    const color = Array.isArray(o.colors) ? o.colors[i] : o.color || css("--series-1");
    const r = el("rect", { x, y: Math.min(y0, y1), width: Math.max(bw - gap, 1), height: h, fill: color, rx: Math.min(3, (bw - gap) / 2) }, svg);
    if (i % every === 0) el("text", { x: x + (bw - gap) / 2, y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, svg).textContent = o.xTick ? o.xTick(o.labels[i], i) : o.labels[i];
    const hit = el("rect", { x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (ev) => {
      const rr = svg.getBoundingClientRect();
      r.setAttribute("opacity", 0.75);
      tip.show(o.tip ? o.tip(i) : `<b>${o.labels[i]}</b><div>${o.yFmt ? o.yFmt(v) : v}</div>`, ev.clientX - rr.left, ev.clientY - rr.top);
    });
    hit.addEventListener("mouseleave", () => { r.setAttribute("opacity", 1); tip.hide(); });
  });
}

// opts: {rows:[labels], cols:[labels], values:[[...]], max, rowTick(i)->str|null, tip(r,c,v)->html}
function heatmap(host, o) {
  host.innerHTML = ""; host.classList.add("chart");
  const W = Math.max(host.clientWidth, 300), rowsN = o.rows.length, colsN = o.cols.length;
  const m = { t: 18, r: 8, b: 8, l: 56 };
  const cw = (W - m.l - m.r) / colsN, ch = o.cellH || Math.max(4, Math.min(10, 520 / rowsN));
  const H = m.t + m.b + ch * rowsN;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" }, host);
  // one-hue orange ramp, cheap to expensive; in dark mode it runs dark to bright (both validated)
  const t = document.documentElement.dataset.theme;
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const ramp = o.ramp || (dark ? ["#834405", "#a05609", "#c46c12", "#e3862a", "#f5ac55", "#fbd7a6"]
                               : ["#f3a347", "#dd7f1a", "#bb640b", "#944d06", "#6c3703", "#482300"]);
  const max = o.max, min = o.min ?? 0;
  const color = (v) => { if (v == null) return "transparent"; const t = Math.min(Math.max((v - min) / (max - min), 0), 0.9999); return ramp[Math.floor(t * ramp.length)]; };
  o.cols.forEach((c, j) => { if (j % 3 === 0) el("text", { x: m.l + j * cw + cw / 2, y: 12, class: "tick", "text-anchor": "middle" }, svg).textContent = c; });
  const tip = tooltip(host);
  o.values.forEach((row, i) => {
    const lab = o.rowTick ? o.rowTick(i) : null;
    if (lab) el("text", { x: m.l - 6, y: m.t + i * ch + ch - 1, class: "tick", "text-anchor": "end" }, svg).textContent = lab;
    row.forEach((v, j) => {
      const r = el("rect", { x: m.l + j * cw, y: m.t + i * ch, width: cw - 1, height: ch - (ch > 5 ? 1 : 0), fill: color(v) }, svg);
      r.addEventListener("mousemove", (ev) => { const rr = svg.getBoundingClientRect(); tip.show(o.tip(i, j, v), ev.clientX - rr.left, ev.clientY - rr.top); });
      r.addEventListener("mouseleave", () => tip.hide());
    });
  });
  // scale
  const sc = document.createElement("div"); sc.className = "scale";
  sc.innerHTML = `<span>${o.scaleLabel ? o.scaleLabel(min) : min}</span>` + ramp.map((c) => `<i style="background:${c}"></i>`).join("") + `<span>${o.scaleLabel ? o.scaleLabel(max) : max}+</span>`;
  host.appendChild(sc);
}

window.Charts = { lineChart, barChart, heatmap, fmt, css };

})();
