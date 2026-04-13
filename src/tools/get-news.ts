import { registerTool } from "./registry.js";

const POSITIVE = new Set(["surge", "rally", "bull", "gain", "rise", "soar", "jump", "high", "boom", "buy", "breakout", "adoption"]);
const NEGATIVE = new Set(["crash", "dump", "bear", "drop", "fall", "plunge", "low", "sell", "fear", "hack", "ban", "fraud"]);

const CRYPTOPANIC_URL = "https://cryptopanic.com/api/free/v1/posts/?auth_token=free&currencies={currency}&kind=news";
const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";

async function fetchCryptopanic(currency: string, limit: number) {
  const url = CRYPTOPANIC_URL.replace("{currency}", currency);
  const resp = await fetch(url, { headers: { "User-Agent": "CryptoAgent/0.1" }, signal: AbortSignal.timeout(10000) });
  const data = await resp.json();
  return ((data as any).results ?? []).slice(0, limit).map((r: any) => ({
    title: r.title,
    url: r.url ?? "",
    published: r.published_at ?? "",
  }));
}

async function fetchCoindeskRss(limit: number) {
  const resp = await fetch(COINDESK_RSS, { headers: { "User-Agent": "CryptoAgent/0.1" }, signal: AbortSignal.timeout(10000) });
  const xml = await resp.text();
  const items: Array<{ title: string; url: string; published: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const content = match[1];
    items.push({
      title: content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") ?? "",
      url: content.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "",
      published: content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "",
    });
  }
  return items;
}

function scoreSentiment(title: string): { label: string; strength: number } {
  const words = new Set(title.toLowerCase().split(/\s+/));
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE.has(w)) pos++;
    if (NEGATIVE.has(w)) neg++;
  }
  if (pos > neg) return { label: "positive", strength: pos - neg };
  if (neg > pos) return { label: "negative", strength: neg - pos };
  return { label: "neutral", strength: 0 };
}

registerTool(
  "get_news",
  "Get crypto news headlines with sentiment analysis for a symbol.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Currency, e.g. BTC", default: "BTC" },
      limit: { type: "integer", description: "Number of headlines", default: 5 },
    },
    required: [],
  },
  async ({ symbol = "BTC", limit = 5 }) => {
    try {
      let headlines: Array<{ title: string; url: string; published: string }>;
      try {
        headlines = await fetchCryptopanic(symbol.toUpperCase().split("/")[0], limit);
      } catch {
        try {
          headlines = await fetchCoindeskRss(limit);
        } catch {
          headlines = [];
        }
      }

      if (!headlines.length) return `No headlines available for ${symbol} at this time.`;

      const lines = [`\ud83d\udcf0 Latest ${symbol} headlines:`];
      headlines.forEach((h, i) => {
        lines.push(`${i + 1}. ${h.title}`);
        if (h.published) lines.push(`   ${h.published}`);
      });
      lines.push("");

      let totalPos = 0;
      let totalNeg = 0;
      const scored = headlines.map((h) => {
        const { label, strength } = scoreSentiment(h.title);
        if (label === "positive") totalPos += strength;
        else if (label === "negative") totalNeg += strength;
        return { title: h.title, sentiment: label, strength };
      });

      const overall = totalPos > totalNeg ? "BULLISH" : totalNeg > totalPos ? "BEARISH" : "NEUTRAL";
      lines.push(`Sentiment: ${overall} (pos=${totalPos}, neg=${totalNeg})`);
      lines.push("");

      const icons: Record<string, string> = { positive: "\ud83d\udfe2", negative: "\ud83d\udd34", neutral: "\u26aa" };
      for (const s of scored) {
        lines.push(`  ${icons[s.sentiment]} [${s.sentiment}] ${s.title}`);
      }

      return lines.join("\n");
    } catch (e: any) {
      return `Error in get_news: ${e.message ?? e}`;
    }
  },
);
