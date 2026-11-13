// Writes test/fixtures/snapshot.json: a SYNTHETIC snapshot with the same
// shape as live data. Used for tests and offline demo mode only. The
// numbers are invented and the dashboard labels them as such.
import { writeFileSync, mkdirSync } from "node:fs";

const DAY = 86400;
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

const end = Math.floor(Date.UTC(2026, 10, 12) / 1000); // 2026-11-12
const days = 400;
const series = (f) => Array.from({ length: days }, (_, i) => {
  const t = end - (days - 1 - i) * DAY;
  return [t, f(i, t)];
});

const vol = series((i) => 40e6 * Math.exp(i * 0.0035) * (0.8 + 0.4 * rand()));
const fees = vol.map(([t, v]) => [t, v * 0.0015 * (0.9 + 0.2 * rand())]);
const rev = fees.map(([t, f], i) => [t, f * (i > 250 ? 0.27 : 0.18)]);
const tvl = series((i) => 30e6 + i * 0.5e6 + 5e6 * Math.sin(i / 20));
const st = series((i) => 700e6 + i * 0.4e6);
const price = series((i) => 2.2 + i * 0.006 + 0.3 * Math.sin(i / 15));

const snap = {
  fetchedAt: "2026-11-13T00:00:00.000Z",
  fixture: true,
  sources: { fixture: { label: "Synthetic fixture (not real data)", provider: "scripts/make-fixture.mjs", url: "" } },
  intents: { volume: vol, fees, revenue: rev, holdersRevenue: rev, tvl },
  stablecoinsNear: st,
  token: { price: price.at(-1)[1], priceSeries: price, totalSupply: 1.31e9, supplySource: "fixture" },
  params: { inflationRate: 0.025, inflationSource: "fixture" },
};

mkdirSync(new URL("../test/fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("../test/fixtures/snapshot.json", import.meta.url), JSON.stringify(snap));
console.log("wrote test/fixtures/snapshot.json (synthetic)");
