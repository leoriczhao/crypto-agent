import { registerTool } from "./registry.js";

const BLOCKCHAIN_INFO_STATS = "https://blockchain.info/stats?format=json";
const BLOCKCHAIR_STATS = "https://api.blockchair.com/{chain}/stats";
const MEMPOOL_FEES = "https://mempool.space/api/v1/fees/recommended";

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "CryptoAgent/0.1" },
    signal: AbortSignal.timeout(10000),
  });
  return resp.json();
}

function formatNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n.toFixed(0)}`;
}

function getNetworkStats(chain: string, data: any): string[] {
  if (chain === "bitcoin") {
    return [
      "Bitcoin Network Stats",
      "=".repeat(40),
      `Market Price:        $${(data.market_price_usd ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `Hash Rate:           ${formatNumber(data.hash_rate ?? 0)} GH/s`,
      `Difficulty:          ${formatNumber(data.difficulty ?? 0)}`,
      `24h Transactions:    ${formatNumber(data.n_tx ?? 0)}`,
      `Mempool Size:        ${formatNumber(data.mempool_size ?? 0)} txs`,
      `Blocks Mined (24h):  ${data.n_blocks_mined ?? 0}`,
      `Total BTC Mined:     ${((data.totalbc ?? 0) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 0 })} BTC`,
      `Minutes Between Blocks: ${(data.minutes_between_blocks ?? 0).toFixed(1)}`,
    ];
  }
  if (chain === "ethereum") {
    const stats = data.data ?? {};
    return [
      "Ethereum Network Stats",
      "=".repeat(40),
      `Market Price:        $${(stats.market_price_usd ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `24h Transactions:    ${formatNumber(stats.transactions_24h ?? 0)}`,
      `Difficulty:          ${formatNumber(stats.difficulty ?? 0)}`,
      `Blocks (24h):        ${formatNumber(stats.blocks_24h ?? 0)}`,
      `Mempool TXs:         ${formatNumber(stats.mempool_transactions ?? 0)}`,
      `Average Block Time:  ${(stats.average_block_time ?? 0).toFixed(1)}s`,
    ];
  }
  return [`Unsupported chain: ${chain}`];
}

function getFees(chain: string, feeData: any, ethData?: any): string[] {
  if (chain === "bitcoin") {
    return [
      "Bitcoin Fee Estimates (sat/vB)",
      "=".repeat(40),
      `Fastest (~10 min):   ${feeData.fastestFee ?? "N/A"} sat/vB`,
      `Half Hour:           ${feeData.halfHourFee ?? "N/A"} sat/vB`,
      `Hour:                ${feeData.hourFee ?? "N/A"} sat/vB`,
      `Economy:             ${feeData.economyFee ?? "N/A"} sat/vB`,
      `Minimum:             ${feeData.minimumFee ?? "N/A"} sat/vB`,
    ];
  }
  if (chain === "ethereum") {
    const stats = (ethData ?? feeData)?.data ?? {};
    return [`Ethereum Median Transaction Fee (24h): $${stats.median_transaction_fee_usd_24h ?? "N/A"}`];
  }
  return [`Unsupported chain: ${chain}`];
}

registerTool(
  "get_chain_stats",
  "Get blockchain network statistics and current fee estimates for Bitcoin or Ethereum.",
  {
    type: "object",
    properties: {
      chain: { type: "string", enum: ["bitcoin", "ethereum"], default: "bitcoin" },
    },
    required: [],
  },
  async ({ chain = "bitcoin" }) => {
    try {
      if (chain === "bitcoin") {
        const [statsData, feeData] = await Promise.all([
          fetchJson(BLOCKCHAIN_INFO_STATS),
          fetchJson(MEMPOOL_FEES),
        ]);
        const lines = getNetworkStats(chain, statsData);
        lines.push("");
        lines.push(...getFees(chain, feeData));
        return lines.join("\n");
      } else {
        const ethData = await fetchJson(BLOCKCHAIR_STATS.replace("{chain}", "ethereum"));
        const lines = getNetworkStats(chain, ethData);
        lines.push("");
        lines.push(...getFees(chain, ethData, ethData));
        return lines.join("\n");
      }
    } catch (e: any) {
      return `Error fetching chain data: ${e.message ?? e}`;
    }
  },
);
