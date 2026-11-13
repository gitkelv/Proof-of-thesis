// Fetches every input the model needs from free, public, keyless sources and
// returns a normalized snapshot. Runs in Node 18+ and in the browser.

export const SOURCES = {
  volume:   { label: "NEAR Intents daily volume", provider: "DefiLlama", url: "https://api.llama.fi/summary/dexs/near-intents?excludeTotalDataChartBreakdown=true" },
  fees:     { label: "NEAR Intents daily fees", provider: "DefiLlama", url: "https://api.llama.fi/summary/fees/near-intents?dataType=dailyFees&excludeTotalDataChartBreakdown=true" },
  revenue:  { label: "NEAR Intents daily revenue", provider: "DefiLlama", url: "https://api.llama.fi/summary/fees/near-intents?dataType=dailyRevenue&excludeTotalDataChartBreakdown=true" },
  holders:  { label: "NEAR Intents holders revenue (buybacks)", provider: "DefiLlama", url: "https://api.llama.fi/summary/fees/near-intents?dataType=dailyHoldersRevenue&excludeTotalDataChartBreakdown=true" },
  tvl:      { label: "NEAR Intents TVL", provider: "DefiLlama", url: "https://api.llama.fi/protocol/near-intents" },
  stables:  { label: "Stablecoin supply on NEAR", provider: "DefiLlama", url: "https://stablecoins.llama.fi/stablecoincharts/Near" },
  price:    { label: "NEAR price history", provider: "DefiLlama coins", url: "https://coins.llama.fi/chart/coingecko:near?span=420&period=1d&start=" },
  chain:    { label: "NEAR total supply + inflation (onchain)", provider: "NEAR RPC", url: "https://rpc.mainnet.near.org" },
};

const RPCS = ["https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com", "https://near.lava.build"];

const DAY = 86400;
const dayStart = (t) => Math.floor(t / DAY) * DAY;

// Collapse to one value per UTC day, oldest first.
export function toDaily(pairs) {
  const m = new Map();
  for (const [t, v] of pairs) {
    const ts = Number(t);
    const val = Number(v);
    if (!Number.isFinite(ts) || !Number.isFinite(val)) continue;
    m.set(dayStart(ts > 1e12 ? ts / 1000 : ts), val);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

// DefiLlama summary endpoints return totalDataChart: [[ts, value], ...]
export function parseSummary(json) {
  const chart = json?.totalDataChart;
  if (!Array.isArray(chart)) throw new Error("summary: missing totalDataChart");
  return toDaily(chart);
}

export function parseTvl(json) {
  const arr = json?.tvl;
  if (!Array.isArray(arr)) throw new Error("tvl: missing tvl[]");
  return toDaily(arr.map((d) => [d.date, d.totalLiquidityUSD]));
}

export function parseStables(json) {
  if (!Array.isArray(json)) throw new Error("stables: expected array");
  return toDaily(json.map((d) => [d.date, d.totalCirculatingUSD?.peggedUSD ?? 0]));
}

export function parsePrice(json) {
  const p = json?.coins?.["coingecko:near"]?.prices;
  if (!Array.isArray(p) || !p.length) throw new Error("price: missing prices");
  return toDaily(p.map((d) => [d.timestamp, d.price]));
}

async function getJson(fetchImpl, url, init) {
  const r = await fetchImpl(url, { ...init, headers: { accept: "application/json", ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

async function rpc(fetchImpl, method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const j = await getJson(fetchImpl, url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "pot", method, params }),
      });
      if (j.error) throw new Error(JSON.stringify(j.error));
      return { result: j.result, url };
    } catch (e) { last = e; }
  }
  throw last;
}

export async function fetchSnapshot(fetchImpl = globalThis.fetch, { log = () => {} } = {}) {
  const start = Math.floor(Date.now() / 1000) - 420 * DAY;
  const step = async (name, fn) => {
    log(`fetch ${name}`);
    return fn();
  };

  const [volume, fees, revenue, holdersRevenue, tvl, stables, priceSeries, block, config] = await Promise.all([
    step("volume", async () => parseSummary(await getJson(fetchImpl, SOURCES.volume.url))),
    step("fees", async () => parseSummary(await getJson(fetchImpl, SOURCES.fees.url))),
    step("revenue", async () => parseSummary(await getJson(fetchImpl, SOURCES.revenue.url))),
    step("holders", async () => {
      try { return parseSummary(await getJson(fetchImpl, SOURCES.holders.url)); }
      catch (e) { log(`holders revenue unavailable, using revenue: ${e.message}`); return []; }
    }),
    step("tvl", async () => parseTvl(await getJson(fetchImpl, SOURCES.tvl.url))),
    step("stables", async () => parseStables(await getJson(fetchImpl, SOURCES.stables.url))),
    step("price", async () => parsePrice(await getJson(fetchImpl, SOURCES.price.url + start))),
    step("block", async () => rpc(fetchImpl, "block", { finality: "final" })),
    step("config", async () => {
      try { return await rpc(fetchImpl, "EXPERIMENTAL_protocol_config", { finality: "final" }); }
      catch (e) { log(`protocol config unavailable: ${e.message}`); return null; }
    }),
  ]);

  // Onchain: total supply is in yoctoNEAR (1e24).
  const totalSupply = Number(BigInt(block.result.header.total_supply) / 10n ** 18n) / 1e6;
  let inflationRate = 0.025;
  const mir = config?.result?.max_inflation_rate;
  if (Array.isArray(mir) && mir[1]) inflationRate = mir[0] / mir[1];

  // Drop today's partial day so 30-day windows are complete.
  const today = dayStart(Math.floor(Date.now() / 1000));
  const complete = (s) => s.filter(([t]) => t < today);

  return {
    fetchedAt: new Date().toISOString(),
    fixture: false,
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { ...v, url: k === "chain" ? block.url : v.url }])),
    intents: {
      volume: complete(volume),
      fees: complete(fees),
      revenue: complete(revenue),
      holdersRevenue: complete(holdersRevenue),
      tvl: complete(tvl),
    },
    stablecoinsNear: complete(stables),
    token: {
      price: priceSeries[priceSeries.length - 1][1],
      priceSeries,
      totalSupply,
      supplySource: `block ${block.result.header.height}`,
    },
    params: { inflationRate, inflationSource: mir ? "EXPERIMENTAL_protocol_config.max_inflation_rate" : "default 2.5%" },
  };
}
