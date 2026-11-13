#!/usr/bin/env node
// Usage:
//   node scripts/run.mjs            fetch live data, run the model, write site/data/
//   node scripts/run.mjs --fixture  run the model on the synthetic fixture (offline)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fetchSnapshot } from "../model/sources.mjs";
import { runModel } from "../model/thesis.mjs";

const fixture = process.argv.includes("--fixture");
const out = new URL("../site/data/", import.meta.url);
mkdirSync(out, { recursive: true });

const snap = fixture
  ? JSON.parse(readFileSync(new URL("../test/fixtures/snapshot.json", import.meta.url)))
  : await fetchSnapshot(fetch, { log: (m) => console.log("  " + m) });

const result = runModel(snap);
writeFileSync(new URL("latest.json", out), JSON.stringify(result, null, 1));

// Daily ledger: one row per real (non-fixture) run, so the track record
// built by GitHub Actions is append-only and auditable in git history.
if (!fixture) {
  writeFileSync(new URL("snapshot.json", out), JSON.stringify(snap));
  const ledgerUrl = new URL("ledger.json", out);
  const ledger = existsSync(ledgerUrl) ? JSON.parse(readFileSync(ledgerUrl)) : [];
  const row = {
    asOf: result.asOf,
    verdict: result.verdict.label,
    claims: Object.fromEntries(result.claims.map((c) => [c.id, c.status])),
    coverage: result.metrics.coverage,
  };
  const i = ledger.findIndex((r) => r.asOf === row.asOf);
  if (i >= 0) ledger[i] = row; else ledger.push(row);
  writeFileSync(ledgerUrl, JSON.stringify(ledger, null, 1));
}

const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");
console.log(`\nProof of Thesis  ·  as of ${result.asOf}${fixture ? "  ·  SYNTHETIC FIXTURE DATA" : ""}`);
console.log(`Verdict: ${result.verdict.label}\n`);
for (const c of result.claims) {
  const v = c.format === "bps" ? (c.value?.toFixed(1) + " bps") : pct(c.value);
  console.log(`  [${c.status.toUpperCase().padEnd(9)}] ${c.title}  (${v})`);
}
const m = result.metrics;
console.log(`\n  Net-deflation needs $${(m.deflationDailyVolume / 1e6).toFixed(0)}M/day of Intents volume; today $${(m.dailyVolNow / 1e6).toFixed(0)}M/day (${m.deflationMultiple?.toFixed(1)}x gap).`);
for (const [k, s] of Object.entries(result.scenarios)) {
  const mt = s.monthsToDeflation == null ? "never at this rate" : s.monthsToDeflation === 0 ? "already" : `${s.monthsToDeflation.toFixed(0)} months`;
  console.log(`  ${k.padEnd(4)} ${pct(s.monthlyGrowth)}/mo  →  12m buybacks $${(s.buybackUsd / 1e6).toFixed(1)}M, net supply ${pct(s.netSupplyChangePct)}, deflation in ${mt}`);
}
console.log(`\nWrote site/data/latest.json`);
