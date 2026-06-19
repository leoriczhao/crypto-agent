export type MarketType = "spot" | "swap";

export interface NormalizedSymbol {
  symbol: string;
  base: string;
  quote: string;
  settle?: string;
  marketType: MarketType;
}

export function normalizeSpotSymbol(symbol: string): NormalizedSymbol {
  const trimmed = symbol.trim().toUpperCase();
  const [base, quote, extra] = trimmed.split("/");
  if (!base || !quote || extra) throw new Error(`Invalid spot symbol: ${symbol}`);
  if (quote.includes(":")) throw new Error(`Invalid spot symbol: ${symbol}`);
  return { symbol: trimmed, base, quote, marketType: "spot" };
}

export function normalizeSwapSymbol(symbol: string): NormalizedSymbol {
  const trimmed = symbol.trim().toUpperCase();
  const [base, quoteSettle, extra] = trimmed.split("/");
  if (!base || !quoteSettle || extra) throw new Error(`Invalid swap symbol: ${symbol}`);
  const [quote, settle, trailing] = quoteSettle.split(":");
  if (!quote || !settle || trailing) throw new Error(`Invalid swap symbol: ${symbol}`);
  if (quote !== "USDT" || settle !== "USDT") {
    throw new Error(`Only USDT linear paper swaps are supported: ${symbol}`);
  }
  return { symbol: trimmed, base, quote, settle, marketType: "swap" };
}

export function normalizeSymbol(symbol: string, marketType?: MarketType): NormalizedSymbol {
  if (marketType === "swap" || symbol.includes(":")) return normalizeSwapSymbol(symbol);
  return normalizeSpotSymbol(symbol);
}
