// Proof of Thesis: the model.
// Pure functions, no dependencies. The same file runs in Node (CI, tests)
// and in the browser (the "rerun live" button on the dashboard).
//
// Input is a normalized snapshot (see normalize.mjs). Every series is an
// array of [unixSeconds, usd] pairs, one per UTC day, oldest first.

export const DAY = 86400;

export const MODEL_VERSION = "1.0.0";

// ---------- small series helpers ----------

export function lastTs(series) {
  return series.length ? series[series.length - 1][0] : 0;
}

// Sum of values in the window (end - offset - days, end - offset].
export function sumWindow(series, endTs, days, offsetDays = 0) {
  const hi = endTs - offsetDays * DAY;
  const lo = hi - days * DAY;
  let s = 0;
  for (const [t, v] of series) if (t > lo && t <= hi) s += v;
  return s;
}

// Value at or just before ts.
export function valueAt(series, ts) {
  let out = null;
  for (const [t, v] of series) {
    if (t <= ts) out = v;
    else break;
  }
  return out;
}

export function pctChange(now, before) {
  if (before == null || now == null || before === 0) return null;
  return now / before - 1;
}

export function truncate(series, ts) {
  return series.filter(([t]) => t <= ts);
}

// Monthly growth rate from a log-linear fit of daily values over `days`.
export function monthlyGrowth(series, endTs, days) {
  const pts = series.filter(([t, v]) => t > endTs - days * DAY && t <= endTs && v > 0);
  if (pts.length < 14) return null;
  const xs = pts.map(([t]) => (t - endTs) / DAY);
  const ys = pts.map(([, v]) => Math.log(v));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const dailySlope = num / den;
  return Math.exp(dailySlope * 30) - 1;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------- metrics ----------

export function computeMetrics(snap, atTs) {
  const i = snap.intents;
  const end = atTs ?? lastTs(i.volume);
  const vol30 = sumWindow(i.volume, end, 30);
  const volPrev30 = sumWindow(i.volume, end, 30, 30);
  const fees30 = sumWindow(i.fees, end, 30);
  const capture = i.holdersRevenue && i.holdersRevenue.length ? i.holdersRevenue : i.revenue;
  const captured30 = sumWindow(capture, end, 30);
  const captured30_90dAgo = sumWindow(capture, end, 30, 90);
  const vol30_90dAgo = sumWindow(i.volume, end, 30, 90);

  const price = atTs != null && snap.token.priceSeries?.length
    ? valueAt(snap.token.priceSeries, end) ?? snap.token.price
    : snap.token.price;
  const price90dAgo = snap.token.priceSeries?.length
    ? valueAt(snap.token.priceSeries, end - 90 * DAY)
    : null;

  // Total supply at `end`, rolled back from the latest supply at the inflation rate.
  const rate = snap.params.inflationRate;
  const yearsBack = (lastTs(i.volume) - end) / (365 * DAY);
  const supply = snap.token.totalSupply / Math.pow(1 + rate, Math.max(0, yearsBack));

  const inflationTokensYr = supply * rate;
  const inflationUsdYr = inflationTokensYr * price;
  const buybackUsdYr = captured30 * (365 / 30);
  const coverage = inflationUsdYr > 0 ? buybackUsdYr / inflationUsdYr : null;

  let coverage90dAgo = null;
  if (price90dAgo) {
    const inf90 = supply / (1 + rate * 90 / 365) * rate * price90dAgo;
    coverage90dAgo = inf90 > 0 ? (captured30_90dAgo * 365 / 30) / inf90 : null;
  }

  const feeBps = vol30 > 0 ? (fees30 / vol30) * 1e4 : null;
  const takeRate = fees30 > 0 ? captured30 / fees30 : null;
  const capturePerVolume = vol30 > 0 ? captured30 / vol30 : null;

  const tvlNow = valueAt(i.tvl, end);
  const tvl30 = valueAt(i.tvl, end - 30 * DAY);
  const stNow = valueAt(snap.stablecoinsNear, end);
  const st90 = valueAt(snap.stablecoinsNear, end - 90 * DAY);

  const dailyVolNow = vol30 / 30;
  const deflationDailyVolume = capturePerVolume > 0 ? inflationUsdYr / 365 / capturePerVolume : null;

  const g90 = monthlyGrowth(i.volume, end, 90);
  const g180 = monthlyGrowth(i.volume, end, 180);

  const marketCap = price * supply;

  return {
    asOfTs: end,
    vol30, volPrev30, volChange30: pctChange(vol30, volPrev30),
    vol30_90dAgo,
    fees30, captured30, captured30_90dAgo,
    captureSource: capture === i.holdersRevenue ? "holdersRevenue" : "revenue",
    feeBps, takeRate, capturePerVolume,
    price, price90dAgo, supply, marketCap,
    inflationRate: rate, inflationTokensYr, inflationUsdYr,
    buybackUsdYr, coverage, coverage90dAgo,
    coverageChange: coverage != null && coverage90dAgo ? coverage / coverage90dAgo - 1 : null,
    tvlNow, tvlChange30: pctChange(tvlNow, tvl30),
    stablecoinsNow: stNow, stablecoinsChange90: pctChange(stNow, st90),
    dailyVolNow, deflationDailyVolume,
    deflationMultiple: deflationDailyVolume && dailyVolNow ? deflationDailyVolume / dailyVolNow : null,
    growth90: g90, growth180: g180,
    mcapToCapture: buybackUsdYr > 0 ? marketCap / buybackUsdYr : null,
  };
}

// ---------- claims and kill criteria ----------
// Each claim states what would prove it wrong. Thresholds live here, in one
// place, so anyone can disagree with a number and rerun.

export const CLAIMS = [
  {
    id: "demand",
    title: "Intents demand is real and growing",
    claim: "Cross-chain swap volume through NEAR Intents keeps growing month over month.",
    metric: "30-day Intents volume vs. the 30 days before",
    kill: "Broken if 30-day volume falls more than 25% vs. the prior 30 days.",
    breakAt: -0.25,
    value: (m) => m.volChange30,
    format: "pct",
    grade: (v) => (v == null ? "unknown" : v >= 0 ? "holding" : v >= -0.25 ? "weakening" : "broken"),
  },
  {
    id: "pricing",
    title: "Users pay for the service",
    claim: "Intents charges a real fee, not a race to zero.",
    metric: "Fees ÷ volume, last 30 days (basis points)",
    kill: "Broken if the fee rate drops below 4 bps.",
    breakAt: 4,
    value: (m) => m.feeBps,
    format: "bps",
    grade: (v) => (v == null ? "unknown" : v >= 8 ? "holding" : v >= 4 ? "weakening" : "broken"),
  },
  {
    id: "capture",
    title: "NEAR captures part of it",
    claim: "A meaningful share of Intents fees flows to NEAR (and funds buybacks), not only to solvers and frontends.",
    metric: "Captured revenue ÷ gross fees, last 30 days",
    kill: "Broken if NEAR's share falls below 10% of fees.",
    breakAt: 0.1,
    value: (m) => m.takeRate,
    format: "pct",
    grade: (v) => (v == null ? "unknown" : v >= 0.2 ? "holding" : v >= 0.1 ? "weakening" : "broken"),
  },
  {
    id: "deflation",
    title: "Buybacks are closing the inflation gap",
    claim: "Annualized buybacks are a growing share of new NEAR issued to validators.",
    metric: "Buyback ÷ inflation (USD/yr), and its change over 90 days",
    kill: "Broken if coverage is under 5% and not rising. Holding needs 25%+ coverage or 50%+ growth in 90 days.",
    breakAt: 0.05,
    value: (m) => m.coverage,
    format: "pct",
    grade: (v, m) => {
      if (v == null) return "unknown";
      const rising = m.coverageChange != null && m.coverageChange > 0;
      if (v >= 0.25 || (m.coverageChange != null && m.coverageChange >= 0.5)) return "holding";
      if (v < 0.05 && !rising) return "broken";
      return "weakening";
    },
  },
  {
    id: "liquidity",
    title: "Liquidity is sticky",
    claim: "Assets parked in the Intents verifier contract stay put rather than fleeing.",
    metric: "Intents TVL change, last 30 days",
    kill: "Broken if TVL falls more than 30% in 30 days.",
    breakAt: -0.3,
    value: (m) => m.tvlChange30,
    format: "pct",
    grade: (v) => (v == null ? "unknown" : v >= -0.1 ? "holding" : v >= -0.3 ? "weakening" : "broken"),
  },
  {
    id: "stablecoins",
    title: "NEAR is becoming a dollar venue",
    claim: "Stablecoin supply on NEAR grows, which gives agents and payments real money to move.",
    metric: "Stablecoin supply on NEAR, change over 90 days",
    kill: "Broken if stablecoin supply on NEAR falls more than 15% in 90 days.",
    breakAt: -0.15,
    value: (m) => m.stablecoinsChange90,
    format: "pct",
    grade: (v) => (v == null ? "unknown" : v >= 0 ? "holding" : v >= -0.15 ? "weakening" : "broken"),
  },
];

export function gradeClaims(m) {
  return CLAIMS.map((c) => {
    const value = c.value(m);
    return {
      id: c.id, title: c.title, claim: c.claim, metric: c.metric, kill: c.kill,
      breakAt: c.breakAt, format: c.format, value, status: c.grade(value, m),
    };
  });
}

export function verdict(graded) {
  const n = (s) => graded.filter((g) => g.status === s).length;
  const broken = n("broken"), holding = n("holding"), unknown = n("unknown");
  let label, tone;
  if (broken >= 2) { label = "Thesis broken"; tone = "broken"; }
  else if (broken === 1 || holding < 4) { label = "Thesis under pressure"; tone = "weakening"; }
  else { label = "Thesis intact"; tone = "holding"; }
  return { label, tone, holding, weakening: n("weakening"), broken, unknown, score: holding * 2 + n("weakening") };
}

// ---------- scenarios ----------

export function scenarioPresets(m) {
  const g = m.growth180 ?? m.growth90 ?? 0;
  return {
    bear: { label: "Bear", monthlyGrowth: clamp(Math.min(0, g) - 0.03, -0.15, 0.25), note: "Volume shrinks 3%/mo (or worse, if the trend is already negative)." },
    base: { label: "Base", monthlyGrowth: clamp(g * 0.5, -0.15, 0.25), note: "Half of the trailing 180-day growth rate: the trend cools." },
    bull: { label: "Bull", monthlyGrowth: clamp(g, -0.15, 0.25), note: "The trailing 180-day growth rate continues." },
  };
}

// Project 12 months forward at a constant monthly volume growth rate.
export function project(m, { monthlyGrowth: g, captureRate, months = 12 } = {}) {
  const k = captureRate ?? m.capturePerVolume ?? 0; // captured USD per USD of volume
  const monthlyVol0 = m.dailyVolNow * 30;
  const monthlyInflationTokens = m.inflationTokensYr / 12;
  const path = [];
  let buybackUsd = 0, buybackTokens = 0, vol = 0, crossMonth = null;
  for (let i = 1; i <= months; i++) {
    const v = monthlyVol0 * Math.pow(1 + g, i);
    const b = v * k;
    vol += v; buybackUsd += b; buybackTokens += b / m.price;
    const net = monthlyInflationTokens - b / m.price;
    if (crossMonth == null && net <= 0) crossMonth = i;
    path.push({ month: i, volume: v, buybackUsd: b, netTokens: net });
  }
  const netTokens = m.inflationTokensYr * (months / 12) - buybackTokens;
  // Months until monthly buyback >= monthly issuance, at constant price.
  let monthsToDeflation = null;
  if (m.deflationMultiple != null) {
    if (m.deflationMultiple <= 1) monthsToDeflation = 0;
    else if (g > 0) monthsToDeflation = Math.log(m.deflationMultiple) / Math.log(1 + g);
  }
  return {
    monthlyGrowth: g, captureRate: k, months,
    volume: vol, buybackUsd, buybackTokens, netTokens,
    netSupplyChangePct: netTokens / m.supply,
    monthsToDeflation, crossMonth, path,
  };
}

// ---------- backfill: how would the thesis have graded on past dates? ----------

export function backfill(snap, weeks = 26) {
  const end = lastTs(snap.intents.volume);
  const out = [];
  for (let w = weeks; w >= 0; w--) {
    const ts = end - w * 7 * DAY;
    if (ts - 120 * DAY < (snap.intents.volume[0]?.[0] ?? Infinity)) continue; // need history
    const m = computeMetrics(snap, ts);
    const g = gradeClaims(m);
    out.push({
      ts,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      verdict: verdict(g).tone,
      claims: Object.fromEntries(g.map((c) => [c.id, c.status])),
      values: Object.fromEntries(g.map((c) => [c.id, c.value])),
      coverage: m.coverage,
      vol30: m.vol30,
    });
  }
  return out;
}

// ---------- one call does it all ----------

export function runModel(snap) {
  const metrics = computeMetrics(snap);
  const claims = gradeClaims(metrics);
  const v = verdict(claims);
  const presets = scenarioPresets(metrics);
  const scenarios = Object.fromEntries(
    Object.entries(presets).map(([k, p]) => [k, { ...p, ...project(metrics, { monthlyGrowth: p.monthlyGrowth }) }])
  );
  return {
    modelVersion: MODEL_VERSION,
    asOf: new Date(metrics.asOfTs * 1000).toISOString().slice(0, 10),
    generatedAt: snap.fetchedAt,
    fixture: !!snap.fixture,
    stale: snap.stale || [],
    sources: snap.sources,
    metrics, claims, verdict: v, scenarios,
    history: backfill(snap),
  };
}
