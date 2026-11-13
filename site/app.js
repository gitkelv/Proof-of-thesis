import { project, MODEL_VERSION } from "./model/thesis.mjs";

const $ = (s) => document.querySelector(s);
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!REDUCE) document.body.classList.add("js-motion");
const el = (tag, attrs = {}, html = "") => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- formatting ----------
const usd = (x, d = 0) => {
  if (x == null || !isFinite(x)) return "n/a";
  const a = Math.abs(x);
  if (a >= 1e9) return "$" + (x / 1e9).toFixed(a >= 1e10 ? 1 : 2) + "B";
  if (a >= 1e6) return "$" + (x / 1e6).toFixed(a >= 1e8 ? 0 : d || 1) + "M";
  if (a >= 1e3) return "$" + (x / 1e3).toFixed(0) + "K";
  return "$" + x.toFixed(2);
};
const pct = (x, d = 1, sign = false) =>
  x == null || !isFinite(x) ? "n/a" : (sign && x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
const fmtClaim = (c, v) => {
  if (v == null) return "n/a";
  if (c.format === "bps") return v.toFixed(1) + " bps";
  if (c.id === "capture" || c.id === "deflation") return pct(v, 1);
  return pct(v, 1, true);
};
const date = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS = { holding: "Holding", weakening: "Weakening", broken: "Broken", unknown: "No data" };
const glyph = (s) => `<span class="glyph s-${s}" aria-hidden="true"></span>`;

// ---------- tooltip ----------
const tip = $("#tip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}
const hideTip = () => (tip.hidden = true);

// ---------- state ----------
let DATA = null;
let activeScenario = "base";
let you = null;

// ---------- render ----------
function render(d) {
  DATA = d;
  const v = d.verdict;
  $("#asof").textContent = date(d.asOf);
  $("#asof").setAttribute("datetime", d.asOf);
  $("#foot-asof").textContent = date(d.asOf);
  $("#ver").textContent = d.modelVersion || MODEL_VERSION;
  const short = { holding: "Intact", weakening: "Under pressure", broken: "Broken" };
  $("#verdict").textContent = short[v.tone] || v.label;
  $("#verdict").style.setProperty("--tone", `var(--${v.tone})`);
  $("#data-kind").textContent = d.fixture ? "Synthetic demo data" : "Live data";
  const parts = [`${v.holding} of ${d.claims.length} claims holding`];
  if (v.weakening) parts.push(`${v.weakening} weakening`);
  parts.push(v.broken ? `${v.broken} broken` : "none broken");
  $("#verdict-sub").textContent = parts.join(", ") + ".";
  document.documentElement.dataset.tone = v.tone;

  const banner = $("#banner");
  if (d.fixture) {
    banner.hidden = false;
    banner.className = "banner";
    banner.innerHTML = `You're looking at synthetic demo data from the offline fixture. Press <b>Rerun live</b> to grade the thesis against real data.`;
  } else banner.hidden = true;

  // scorecard
  const sc = $("#scorecard");
  sc.innerHTML = "";
  d.claims.forEach((c, i) => {
    const li = el("li");
    li.innerHTML = `<a href="#claim-${c.id}">${glyph(c.status)}<span class="rl-title">${esc(c.title)}</span><span class="rl-val">${fmtClaim(c, c.value)}</span><span class="sr-only">: ${STATUS[c.status]}</span></a>`;
    sc.append(li);
    setTimeout(() => li.classList.add("in"), REDUCE ? 0 : 350 + i * 170);
  });

  // sources
  const seen = new Map();
  for (const s of Object.values(d.sources || {})) {
    if (!seen.has(s.provider)) seen.set(s.provider, []);
    seen.get(s.provider).push(s.label);
  }
  const ICON = {
    "DefiLlama": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15l4-5 3 3 7-8"/><path d="M3 18h14"/></svg>',
    "DefiLlama coins": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="7"/><path d="M10 6v8M7.5 8.2c0-1 1-1.7 2.5-1.7s2.5.6 2.5 1.6-1 1.4-2.5 1.7-2.5.8-2.5 1.8 1 1.6 2.5 1.6 2.5-.7 2.5-1.6"/></svg>',
    "NEAR RPC": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="14" height="5" rx="1.5"/><rect x="3" y="12" width="14" height="5" rx="1.5"/><path d="M6 5.5h.01M6 14.5h.01"/></svg>',
  };
  const fallback = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="14" height="14" rx="3"/></svg>';
  $("#sources").innerHTML = [...seen.entries()]
    .map(([p, ls]) => `<li title="${esc(ls.join(", "))}">${ICON[p] || fallback}${esc(p)}<small>${ls.length} series</small></li>`).join("");

  renderHero(d);
  renderClaims(d);
  renderRecord(d);
  renderKill(d);
  renderGap(d);
  you = you || { g: d.scenarios.base.monthlyGrowth, k: d.metrics.capturePerVolume };
  renderScenario();
}

function renderHero(d) {
  const m = d.metrics, v = d.verdict;
  $("#pill-text").textContent = `Graded ${date(d.asOf)}: ${v.label.toLowerCase().replace(/^thesis/, "thesis")}`;
  $("#pill-dot").style.background = `var(--${v.tone})`;
  $("#hero-cov").textContent = pct(m.coverage, 1);
  $("#hero-vol").textContent = usd(m.dailyVolNow) + "/day";
  $("#hero-need").textContent = usd(m.deflationDailyVolume) + "/day";
  $("#stat-holding").textContent = `${v.holding}/${d.claims.length}`;
  $("#stat-cover").textContent = pct(m.coverage, 0);
  $("#stat-vol").textContent = usd(m.dailyVolNow);
  $("#stat-mult").textContent = m.deflationMultiple == null ? "n/a" : m.deflationMultiple <= 1 ? "None" : m.deflationMultiple.toFixed(1) + "x";
  coverChart($("#hero-cov-chart"), d.history);
  ring($("#ring"), d);
}

function coverChart(host, H) {
  const pts = H.filter((h) => h.coverage != null && isFinite(h.coverage));
  if (pts.length < 2) { host.innerHTML = ""; return; }
  const W = host.clientWidth || 480, Ht = host.clientHeight || 170, L = 40, R = 6, T = 8, B = 22;
  const max = Math.max(...pts.map((p) => p.coverage)) * 1.15 || 1;
  const ticks = niceTicks(0, max, 3);
  const top = Math.max(max, ticks.at(-1));
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (Ht - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.coverage).toFixed(1)}`).join("");
  const area = line + `L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = pts.length - 1;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Buyback coverage of issuance went from ${pct(pts[0].coverage, 1)} on ${pts[0].date} to ${pct(pts[last].coverage, 1)} on ${pts[last].date}.">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9d8cff" stop-opacity=".35"/><stop offset="1" stop-color="#9d8cff" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
    ${ticks.map((t) => `<text class="axis-t" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${pct(t, 0)}</text>`).join("")}
    <text class="axis-t" x="${L}" y="${Ht - 4}">${shortDate(pts[0].date)}</text>
    <text class="axis-t" x="${W - R}" y="${Ht - 4}" text-anchor="end">${shortDate(pts[last].date)}</text>
    <path d="${area}" fill="url(#cg)"/>
    <path d="${line}" class="ln" stroke="var(--iris)"/>
    <circle cx="${x(last)}" cy="${y(pts[last].coverage)}" r="5" fill="var(--iris)" stroke="#0c0b1a" stroke-width="2"/>
    <line class="hair" x1="0" x2="0" y1="${T}" y2="${Ht - B}" stroke="rgba(255,255,255,.3)" visibility="hidden"/>
    <circle class="hdot" r="5" fill="var(--iris)" stroke="#0c0b1a" stroke-width="2" visibility="hidden"/>
  </svg>`;
  const svg = host.querySelector("svg"), hair = svg.querySelector(".hair"), dot = svg.querySelector(".hdot");
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - L) / (W - L - R)) * last)));
    for (const a of ["x1", "x2"]) hair.setAttribute(a, x(i));
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i].coverage));
    hair.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    showTip(`<b>${pct(pts[i].coverage, 1)}</b> of issuance bought back<br><span class="muted">Week of ${shortDate(pts[i].date)}</span>`, e.clientX, e.clientY);
  };
  svg.onpointerleave = () => { hair.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); };
}

function ring(host, d) {
  const n = d.claims.length, R = 80, C = 2 * Math.PI * R, gap = 6;
  const seg = C / n - gap;
  const label = { holding: "Intact", weakening: "Under pressure", broken: "Broken" }[d.verdict.tone];
  host.setAttribute("aria-label", `Verdict ring: ${d.claims.map((c) => `${c.title}, ${STATUS[c.status]}`).join("; ")}`);
  host.innerHTML = `<svg viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(190,182,255,.08)" stroke-width="14"/>
    ${d.claims.map((c, i) => `<circle class="seg" cx="100" cy="100" r="${R}" fill="none" stroke="var(--${c.status})" stroke-width="14"
        stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${REDUCE ? -(i * C / n) : -(i * C / n) + seg}" data-off="${-(i * C / n)}" transform="rotate(-90 100 100)"><title>${esc(c.title)}: ${STATUS[c.status]}</title></circle>`).join("")}
    <text x="100" y="96" text-anchor="middle" fill="var(--ink)" style="font:600 22px var(--sans);letter-spacing:-.03em">${label}</text>
    <text x="100" y="120" text-anchor="middle" fill="var(--ink-3)" style="font:12px var(--sans)">${d.verdict.holding} of ${n} holding</text>
  </svg>`;
  onceVisible(host, () => host.querySelectorAll(".seg").forEach((s, i) => setTimeout(() => s.setAttribute("stroke-dashoffset", s.dataset.off), i * 120)), 0.4);
}

function renderClaims(d) {
  const grid = $("#claim-grid");
  grid.innerHTML = "";
  for (const c of d.claims) {
    const card = el("article", { class: "claim", id: `claim-${c.id}` });
    card.style.setProperty("--c", `var(--${c.status})`);
    card.classList.add("panel");
    card.innerHTML = `
      <span class="scan" aria-hidden="true"></span>
      <p class="status">${REDUCE ? glyph(c.status) + STATUS[c.status] : '<span class="glyph s-pending" aria-hidden="true"></span>Grading…'}</p>
      <h3>${esc(c.title)}</h3>
      <p class="why">${esc(c.claim)}</p>
      <div class="reading"><span class="value">${fmtClaim(c, c.value)}</span><span class="metric">${esc(c.metric)}</span></div>
      <div class="spark" data-id="${c.id}"></div>
      <p class="kill-line">${esc(c.kill)}</p>`;
    grid.append(card);
    spark(card.querySelector(".spark"), d.history, c);
    card._grade = () => {
      card.querySelector(".status").innerHTML = glyph(c.status) + STATUS[c.status];
      card.classList.add("graded");
    };
    if (REDUCE) card.classList.add("in", "graded");
    else cardObserver.observe(card);
  }
}

function spark(host, history, c) {
  const pts = history.map((h) => ({ date: h.date, v: h.values?.[c.id], s: h.claims[c.id] })).filter((p) => p.v != null && isFinite(p.v));
  if (pts.length < 2) { host.innerHTML = `<p class="metric">Not enough history yet.</p>`; return; }
  const W = 300, H = 64, pad = 4;
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals, c.breakAt ?? Infinity), hi = Math.max(...vals);
  if (c.breakAt != null && c.breakAt > hi) hi = c.breakAt;
  const span = hi - lo || 1; lo -= span * 0.08; hi += span * 0.08;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const ky = c.breakAt != null ? y(c.breakAt) : null;
  const last = pts.length - 1;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(c.title)}: ${fmtClaim(c, pts[0].v)} on ${pts[0].date}, ${fmtClaim(c, pts[last].v)} on ${pts[last].date}">
    ${ky != null ? `<line x1="0" x2="${W}" y1="${ky}" y2="${ky}" stroke="var(--broken)" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" opacity=".8"/>` : ""}
    <path d="${path}" class="ln" stroke="var(--${c.status})" vector-effect="non-scaling-stroke"/>
    <line class="hair" x1="0" x2="0" y1="0" y2="${H}" stroke="rgba(255,255,255,.35)" vector-effect="non-scaling-stroke" visibility="hidden"/>
  </svg>`;
  const svg = host.querySelector("svg"), hair = svg.querySelector(".hair");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (W - pad * 2) / ((W - pad * 2) / (pts.length - 1)));
    const p = pts[Math.max(0, Math.min(last, i))];
    const xi = x(Math.max(0, Math.min(last, i)));
    hair.setAttribute("x1", xi); hair.setAttribute("x2", xi); hair.setAttribute("visibility", "visible");
    showTip(`<b>${fmtClaim(c, p.v)}</b> <span class="muted">week of ${shortDate(p.date)}</span><br>${glyph(p.s)} ${STATUS[p.s]}${c.breakAt != null ? `<br><span class="muted">Kill line: ${fmtClaim(c, c.breakAt)}</span>` : ""}`, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); hideTip(); });
}

function renderRecord(d) {
  const g = $("#record-grid");
  const H = d.history;
  const labelW = innerWidth < 640 ? 150 : 250;
  g.style.gridTemplateColumns = `${labelW}px repeat(${H.length}, minmax(14px, 1fr))`;
  g.style.minWidth = labelW + H.length * 17 + "px";
  g.innerHTML = "";
  const row = (label, cls, statusOf, title) => {
    const r = el("div", { role: "row", style: "display:contents" });
    r.append(el("div", { class: "rlabel " + cls, role: "rowheader" }, esc(label)));
    H.forEach((h) => {
      const s = statusOf(h);
      const cell = el("div", { class: "cell " + s, role: "cell", style: `--i:${H.indexOf(h)}`, "aria-label": `${label}, week of ${h.date}: ${STATUS[s] || s}` });
      cell.addEventListener("pointermove", (e) => showTip(`<b>${esc(label)}</b><br><span class="muted">Week of ${shortDate(h.date)}</span><br>${glyph(s)} ${title(h, s)}`, e.clientX, e.clientY));
      cell.addEventListener("pointerleave", hideTip);
      r.append(cell);
    });
    g.append(r);
  };
  const vLabel = { holding: "Intact", weakening: "Under pressure", broken: "Broken" };
  row("Overall verdict", "verdict-row", (h) => h.verdict, (h, s) => vLabel[s]);
  const spacer = el("div", { style: `grid-column:1 / -1;height:8px` });
  g.append(spacer);
  for (const c of d.claims) {
    row(c.title, "", (h) => h.claims[c.id] || "unknown", (h, s) => `${STATUS[s]}${h.values?.[c.id] != null ? ", " + fmtClaim(c, h.values[c.id]) : ""}`);
  }
  const ax = el("div", { style: "display:contents" });
  ax.append(el("div"));
  H.forEach((h, i) => {
    const a = el("div", { class: "axis" });
    if (i === 0 || i === H.length - 1 || i === Math.floor(H.length / 2)) a.textContent = shortDate(h.date);
    a.style.whiteSpace = "nowrap";
    if (i === H.length - 1) { a.style.direction = "rtl"; }
    ax.append(a);
  });
  g.append(ax);
  const wrap = g.parentElement; wrap.scrollLeft = wrap.scrollWidth;
  if (REDUCE) g.classList.add("in"); else onceVisible(g, () => g.classList.add("in"), 0.3);
}

function renderKill(d) {
  $("#kill-body").innerHTML = d.claims.map((c) => `<tr>
    <td>${esc(c.title)}</td><td>${esc(c.metric)}</td>
    <td><span class="today">${glyph(c.status)}${fmtClaim(c, c.value)}</span></td>
    <td>${esc(c.kill.replace(/^Broken if /, "").replace(/^./, (m) => m.toUpperCase()))}</td></tr>`).join("");
}

function renderGap(d) {
  const m = d.metrics;
  const max = Math.max(m.dailyVolNow, m.deflationDailyVolume || 0) || 1;
  onceVisible($("#gap"), () => {
    $("#gap-now").style.width = (m.dailyVolNow / max) * 100 + "%";
    $("#gap-need").style.width = ((m.deflationDailyVolume || 0) / max) * 100 + "%";
  }, 0.5);
  $("#gap-now-v").textContent = usd(m.dailyVolNow) + "/day";
  $("#gap-need-v").textContent = usd(m.deflationDailyVolume) + "/day";
  const mult = m.deflationMultiple;
  $("#gap-note").textContent = mult == null ? "Not enough data to compute the gap."
    : mult <= 1 ? `Buybacks already exceed issuance. NEAR is net deflationary at today's volume.`
    : `Intents volume has to grow ${mult.toFixed(1)}x for buybacks to cover the ${pct(m.inflationRate, 1)} yearly issuance (${usd(m.inflationUsdYr)} a year at today's price). Today buybacks cover ${pct(m.coverage, 0)} of it.`;
}

function renderScenario() {
  const d = DATA, m = d.metrics;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === activeScenario)));
  $("#scen-panel").setAttribute("aria-labelledby", "tab-" + activeScenario);
  const isYou = activeScenario === "you";
  $("#sliders").hidden = !isYou;
  let g, k, note;
  if (isYou) {
    g = you.g; k = you.k;
    note = "Set your own growth and capture assumptions. Everything else stays at today's onchain values.";
    $("#g-in").value = (g * 100).toFixed(1); $("#g-out").textContent = pct(g, 1, true) + "/mo";
    $("#k-in").value = (k * 1e4).toFixed(1); $("#k-out").textContent = (k * 1e4).toFixed(1) + " bps";
  } else {
    const s = d.scenarios[activeScenario];
    g = s.monthlyGrowth; k = m.capturePerVolume; note = s.note;
  }
  $("#scen-note").textContent = note;
  const p12 = project(m, { monthlyGrowth: g, captureRate: k, months: 12 });
  const p36 = project(m, { monthlyGrowth: g, captureRate: k, months: 36 });
  const mt = (() => {
    const mult = m.deflationMultiple * ((m.capturePerVolume || 1) / (k || 1e-12));
    if (!isFinite(mult)) return "Never";
    if (mult <= 1) return "Already";
    if (g <= 0) return "Never at this rate";
    const n = Math.log(mult) / Math.log(1 + g);
    return n > 120 ? "More than 10 years" : n < 12 ? `${Math.ceil(n)} months` : `${(n / 12).toFixed(1)} years`;
  })();
  $("#scen-figs").innerHTML = `
    <div><dt>Volume growth</dt><dd>${pct(g, 1, true)} a month</dd></div>
    <div><dt>Buybacks over the next 12 months</dt><dd>${usd(p12.buybackUsd)}</dd></div>
    <div><dt>Net change in NEAR supply, 12 months</dt><dd>${pct(p12.netSupplyChangePct, 2, true)}</dd></div>
    <div><dt>Time until buybacks outrun issuance</dt><dd>${mt}</dd></div>`;
  chart($("#scen-svg"), p36, m);
}

function chart(host, p, m) {
  const W = host.clientWidth || 600, H = host.clientHeight || 300;
  const L = 56, R = 12, T = 12, B = 28;
  const issuance = (m.inflationTokensYr / 12) * m.price;
  const data = p.path.map((r) => ({ month: r.month, b: r.buybackUsd }));
  const maxY = Math.max(issuance * 1.25, ...data.map((r) => r.b)) * 1.05;
  const x = (mth) => L + ((mth - 1) / (data.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  const ticks = niceTicks(0, maxY, 4);
  const line = data.map((r, i) => `${i ? "L" : "M"}${x(r.month).toFixed(1)},${y(r.b).toFixed(1)}`).join("");
  const cross = data.find((r) => r.b >= issuance);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly buybacks rise from ${usd(data[0].b)} to ${usd(data.at(-1).b)} over 36 months, against issuance of ${usd(issuance)} a month.${cross ? ` Buybacks pass issuance in month ${cross.month}.` : " Buybacks do not pass issuance within 36 months."}">
    <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
    ${ticks.map((t) => `<text class="axis-t" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${usd(t)}</text>`).join("")}
    ${[1, 12, 24, 36].map((mm) => `<text class="axis-t" x="${x(mm)}" y="${H - 6}" text-anchor="${mm === 1 ? "start" : mm === 36 ? "end" : "middle"}">${mm === 1 ? "Month 1" : mm}</text>`).join("")}
    <line x1="${L}" x2="${W - R}" y1="${y(issuance)}" y2="${y(issuance)}" stroke="var(--ink-2)" stroke-width="2" stroke-dasharray="6 6"/>
    <path d="${line}" class="ln" stroke="var(--iris)"/>
    ${cross ? `<circle cx="${x(cross.month)}" cy="${y(cross.b)}" r="6" fill="var(--holding)" stroke="#000" stroke-width="2"/>
      <text class="axis-t" x="${x(cross.month)}" y="${y(cross.b) - 14}" text-anchor="${cross.month > 30 ? "end" : "middle"}" style="fill:var(--ink)">Net deflation, month ${cross.month}</text>` : ""}
    <line class="hair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.3)" visibility="hidden"/>
    <circle class="hdot" r="5" fill="var(--iris)" stroke="#000" stroke-width="2" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg>`;
  const svg = host.querySelector("svg"), hair = svg.querySelector(".hair"), dot = svg.querySelector(".hdot");
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - L) / (W - L - R)) * (data.length - 1))));
    const d = data[i];
    for (const a of ["x1", "x2"]) hair.setAttribute(a, x(d.month));
    dot.setAttribute("cx", x(d.month)); dot.setAttribute("cy", y(d.b));
    hair.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    showTip(`<b>Month ${d.month}</b><br>Buybacks ${usd(d.b)}<br><span class="muted">Issuance ${usd(issuance)}</span>`, e.clientX, e.clientY);
  };
  svg.onpointerleave = () => { hair.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); };
}

function niceTicks(lo, hi, n) {
  const step0 = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0);
  const out = [];
  for (let v = 0; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

// ---------- scroll effects ----------
function onceVisible(node, fn, threshold = 0.2) {
  if (REDUCE || !("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { io.disconnect(); fn(); }
  }, { threshold });
  io.observe(node);
}
const cardObserver = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    const card = e.target;
    cardObserver.unobserve(card);
    const delay = [...card.parentElement.children].indexOf(card) % 3 * 140;
    setTimeout(() => card.classList.add("in"), delay);
    setTimeout(() => card._grade?.(), delay + 900);
  }
}, { threshold: 0.35 }) : { observe: (c) => { c.classList.add("in"); c._grade?.(); } };

document.querySelectorAll(".reveal").forEach((n) => onceVisible(n, () => n.classList.add("in"), 0.15));

const root = document.documentElement;
const heroCopy = $("#hero-copy"), bento = $("#bento"), steps = $("#steps"), stepItems = [...document.querySelectorAll(".step")];
let ticking = false;
function onScroll() {
  ticking = false;
  const y = scrollY, vh = innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  root.style.setProperty("--scroll", max > 0 ? Math.min(1, y / max).toFixed(4) : 0);
  if (!REDUCE && y < vh * 1.2) {
    const k = Math.min(1, y / (vh * 0.8));
    heroCopy.style.transform = `translateY(${y * 0.18}px)`;
    heroCopy.style.opacity = String(1 - k * 0.7);
    const t = Math.min(1, y / (vh * 0.45));
    bento.style.transform = `rotateX(${(1 - t) * 12}deg) scale(${0.94 + t * 0.06})`;
  }
  // method: the line draws as the section passes the middle of the screen
  const r = steps.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (vh * 0.6 - r.top) / r.height));
  steps.style.setProperty("--p", p.toFixed(3));
  for (const li of stepItems) li.classList.toggle("on", li.getBoundingClientRect().top < vh * 0.6);
}
addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

// countdown to the next daily run (06:17 UTC)
function nextRun() {
  const now = new Date();
  const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 17));
  if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
  const mins = Math.round((n - now) / 60000);
  $("#next-run").textContent = `Next grading in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}
nextRun(); setInterval(nextRun, 30000);

// ---------- interactions ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => { activeScenario = b.dataset.k; renderScenario(); });
  b.addEventListener("keydown", (e) => {
    const tabs = [...document.querySelectorAll(".tabs button")];
    const i = tabs.indexOf(b);
    const j = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : null;
    if (j != null) { tabs[j].focus(); tabs[j].click(); }
  });
});
$("#g-in").addEventListener("input", (e) => { you.g = e.target.value / 100; renderScenario(); });
$("#k-in").addEventListener("input", (e) => { you.k = e.target.value / 1e4; renderScenario(); });
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (DATA) { renderScenario(); coverChart($("#hero-cov-chart"), DATA.history); } }, 150); });

async function rerun() {
  const btns = [$("#rerun"), $("#rerun-nav")];
  const status = $("#run-status");
  btns.forEach((b) => (b.disabled = true));
  status.textContent = "Fetching from DefiLlama and a NEAR RPC node…";
  try {
    const [{ fetchSnapshot }, { runModel }] = await Promise.all([import("./model/sources.mjs"), import("./model/thesis.mjs")]);
    let fallback = null;
    try { const r = await fetch("data/snapshot.json", { cache: "no-cache" }); if (r.ok) fallback = await r.json(); } catch {}
    const snap = await fetchSnapshot(fetch, { fallback, log: (m) => (status.textContent = m.replace(/^fetch /, "Fetching ") + "…") });
    if (snap.stale.length >= Object.keys(snap.sources).length) throw new Error("any of the data sources");
    const result = runModel(snap);
    render(result);
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const n = Object.keys(snap.sources).length;
    status.textContent = snap.stale.length
      ? `Regraded in your browser at ${t}. ${n - snap.stale.length} of ${n} sources fetched live; ${snap.stale.join(", ")} came from the last daily run because your browser couldn't reach it.`
      : `Regraded live in your browser at ${t}, using the same model file as the daily run.`;
  } catch (e) {
    status.textContent = "";
    const banner = $("#banner");
    banner.hidden = false; banner.className = "banner err";
    banner.textContent = `Live rerun couldn't reach ${e.message}. The grades below are from this morning's daily run. Try again in a minute.`;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}
$("#rerun").addEventListener("click", rerun);
$("#rerun-nav").addEventListener("click", rerun);

// repo link from the GitHub Pages URL (owner.github.io/repo)
(() => {
  const h = location.hostname;
  if (h.endsWith(".github.io")) {
    const owner = h.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0] || "proof-of-thesis";
    const url = `https://github.com/${owner}/${repo}`;
    $("#repo-link").href = url;
    $("#clone").textContent = $("#clone").textContent.replace("https://github.com/OWNER/proof-of-thesis", url);
  } else {
    $("#repo-link").href = "https://github.com/";
  }
})();

// ---------- boot ----------
(async () => {
  try {
    const r = await fetch("data/latest.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("no published data");
    render(await r.json());
  } catch {
    $("#run-status").textContent = "No published run found. Grading live…";
    rerun();
  }
})();
