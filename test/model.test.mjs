import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAY, sumWindow, valueAt, monthlyGrowth, computeMetrics, gradeClaims,
  verdict, project, runModel, CLAIMS,
} from "../model/thesis.mjs";
import { parseSummary, parseTvl, parseStables, parsePrice, toDaily } from "../model/sources.mjs";

const snap = JSON.parse(readFileSync(new URL("./fixtures/snapshot.json", import.meta.url)));
const flat = (n, v, end = 100 * DAY) => Array.from({ length: n }, (_, i) => [end - (n - 1 - i) * DAY, v]);

test("sumWindow sums exactly N days and respects offset", () => {
  const s = flat(90, 1);
  const end = s.at(-1)[0];
  assert.equal(sumWindow(s, end, 30), 30);
  assert.equal(sumWindow(s, end, 30, 30), 30);
  assert.equal(sumWindow(s, end, 30, 75), 15); // only 15 days exist that far back
});

test("valueAt returns the last value at or before ts", () => {
  const s = [[10, 1], [20, 2], [30, 3]];
  assert.equal(valueAt(s, 25), 2);
  assert.equal(valueAt(s, 5), null);
});

test("monthlyGrowth recovers a known growth rate", () => {
  const end = 1000 * DAY;
  const s = Array.from({ length: 180 }, (_, i) => [end - (179 - i) * DAY, 100 * Math.pow(1.1, i / 30)]);
  assert.ok(Math.abs(monthlyGrowth(s, end, 180) - 0.1) < 1e-6);
});

test("every claim states a kill criterion", () => {
  for (const c of CLAIMS) assert.match(c.kill, /Broken if/);
});

test("demand claim breaks when volume falls more than 25%", () => {
  const c = CLAIMS.find((x) => x.id === "demand");
  assert.equal(c.grade(0.1), "holding");
  assert.equal(c.grade(-0.1), "weakening");
  assert.equal(c.grade(-0.3), "broken");
  assert.equal(c.grade(null), "unknown");
});

test("deflation claim: low and falling coverage is broken, fast growth is holding", () => {
  const c = CLAIMS.find((x) => x.id === "deflation");
  assert.equal(c.grade(0.03, { coverageChange: -0.2 }), "broken");
  assert.equal(c.grade(0.03, { coverageChange: 0.6 }), "holding");
  assert.equal(c.grade(0.12, { coverageChange: 0.1 }), "weakening");
  assert.equal(c.grade(0.3, { coverageChange: -0.1 }), "holding");
});

test("verdict: two broken claims break the thesis", () => {
  const g = (s) => ({ status: s });
  assert.equal(verdict([g("broken"), g("broken"), g("holding")]).tone, "broken");
  assert.equal(verdict([g("holding"), g("holding"), g("holding"), g("holding"), g("weakening")]).tone, "holding");
  assert.equal(verdict([g("holding"), g("broken"), g("holding"), g("holding"), g("holding")]).tone, "weakening");
});

test("metrics on the fixture are internally consistent", () => {
  const m = computeMetrics(snap);
  assert.ok(m.vol30 > 0 && m.fees30 > 0);
  assert.ok(Math.abs(m.feeBps - (m.fees30 / m.vol30) * 1e4) < 1e-9);
  assert.ok(Math.abs(m.coverage - m.buybackUsdYr / m.inflationUsdYr) < 1e-12);
  // At the deflation threshold, daily buyback equals daily inflation in USD.
  assert.ok(Math.abs(m.deflationDailyVolume * m.capturePerVolume * 365 - m.inflationUsdYr) < 1);
});

test("projection: zero growth never reaches deflation when coverage < 100%", () => {
  const m = computeMetrics(snap);
  const p = project(m, { monthlyGrowth: 0 });
  assert.equal(p.monthsToDeflation, null);
  assert.ok(Math.abs(p.buybackUsd - m.dailyVolNow * 30 * 12 * m.capturePerVolume) < 1);
});

test("projection: higher growth means more buybacks and less dilution", () => {
  const m = computeMetrics(snap);
  const lo = project(m, { monthlyGrowth: 0.02 });
  const hi = project(m, { monthlyGrowth: 0.1 });
  assert.ok(hi.buybackUsd > lo.buybackUsd);
  assert.ok(hi.netSupplyChangePct < lo.netSupplyChangePct);
  assert.ok(hi.monthsToDeflation < lo.monthsToDeflation);
});

test("runModel returns claims, scenarios and a backfilled history", () => {
  const r = runModel(snap);
  assert.equal(r.claims.length, CLAIMS.length);
  assert.deepEqual(Object.keys(r.scenarios), ["bear", "base", "bull"]);
  assert.ok(r.history.length >= 20, "about 26 weekly backfill points");
  assert.equal(r.fixture, true);
  assert.ok(r.scenarios.bear.monthlyGrowth <= r.scenarios.base.monthlyGrowth);
  assert.ok(r.scenarios.base.monthlyGrowth <= r.scenarios.bull.monthlyGrowth || r.scenarios.bull.monthlyGrowth < 0);
});

test("parsers accept the public API shapes", () => {
  assert.deepEqual(parseSummary({ totalDataChart: [[86400, 5], [86400 * 2, 6]] }), [[86400, 5], [172800, 6]]);
  assert.deepEqual(parseTvl({ tvl: [{ date: 86400, totalLiquidityUSD: 9 }] }), [[86400, 9]]);
  assert.deepEqual(parseStables([{ date: "86400", totalCirculatingUSD: { peggedUSD: 7 } }]), [[86400, 7]]);
  assert.deepEqual(parsePrice({ coins: { "coingecko:near": { prices: [{ timestamp: 86400, price: 3 }] } } }), [[86400, 3]]);
  assert.deepEqual(toDaily([[1731456000 * 1000 + 5000, 1]]), [[1731456000, 1]], "milliseconds are normalized to day starts");
  assert.throws(() => parseSummary({}), /totalDataChart/);
});
