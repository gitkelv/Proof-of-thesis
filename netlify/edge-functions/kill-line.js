// Kill Line: turns a plain-language investment thesis into testable claims,
// each with an onchain metric and a pre-committed kill threshold, using
// SERV Reasoning (OpenServ's inference API). The key stays server-side.
//
// Streams the model's output straight through, so the page can show it
// arriving and the edge function never waits on a long reasoning call.

const SERV_URL = "https://inference-api.openserv.ai/v1/chat/completions";

const SYSTEM = `You are Kill Line, a ruthless but fair crypto investment-thesis auditor.

Given an investment thesis in plain language, break it into the distinct claims it depends on, and for each claim decide whether it can be checked against public, ideally onchain, data.

For every claim:
- "claim": the claim restated in one short sentence (max 14 words).
- "kind": "testable" if a public metric can confirm or refute it on a schedule, "partial" if only a proxy exists, "vibes" if no data could ever prove it wrong.
- "metric": the exact metric to track, specific enough to compute (e.g. "30-day DEX volume on Base vs prior 30 days"). For vibes, write "none".
- "source": the most likely public source (e.g. "DefiLlama", "Dune", "Token Terminal", "chain RPC", "Artemis", "CoinGecko", "Electric Capital"). For vibes, write "none".
- "kill": the pre-committed threshold that would prove the claim wrong, as a concrete number and window (e.g. "volume falls more than 25% over 30 days"). For vibes, say what would have to be added to make it testable.
- "weight": 1 to 5, how much the whole thesis depends on this claim.
- "why": one sentence on why this is the right metric, or why it is untestable.

Then give:
- "asset": the asset or protocol the thesis is about.
- "summary": the thesis in one sentence.
- "testability": 0 to 100, the weight-adjusted share of the thesis that can be proven wrong by data.
- "weakest": the single claim (restated) the thesis is most exposed on, and why, in one sentence.
- "verdict": one punchy sentence an investor would remember.

Rules: 3 to 7 claims. Never invent current numbers or prices; thresholds are relative changes or ratios unless the thesis itself states a number. Be honest about vibes: a claim like "the community is strong" is vibes unless tied to a metric.

Reply with ONLY a JSON object of this shape, no prose, no code fences:
{"asset":"","summary":"","testability":0,"weakest":"","verdict":"","claims":[{"claim":"","kind":"testable","metric":"","source":"","kill":"","weight":3,"why":""}]}`;

export default async (req) => {
  const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST a thesis" }, 405);

  const key = Netlify.env.get("SERV_API_KEY") || Netlify.env.get("OPENSERV_API_KEY");
  if (!key) return json({ error: "The SERV Reasoning key isn't set on this deployment yet." }, 503);

  let thesis = "";
  try { thesis = String((await req.json()).thesis || "").trim(); } catch { /* fall through */ }
  if (thesis.length < 40) return json({ error: "Write at least a couple of sentences of thesis." }, 400);
  if (thesis.length > 6000) thesis = thesis.slice(0, 6000);

  const model = Netlify.env.get("SERV_MODEL") || "gpt-5.4-mini";
  const upstream = await fetch(SERV_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Thesis:\n"""\n${thesis}\n"""` },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    return json({ error: `SERV Reasoning returned ${upstream.status}.`, detail }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-serv-model": model,
    },
  });
};

export const config = { path: "/api/kill-line" };
