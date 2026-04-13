export function computeSma(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function computeRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }
  const recent = deltas.slice(-period);
  const avgGain = recent.reduce((s, d) => s + (d > 0 ? d : 0), 0) / period;
  const avgLoss = recent.reduce((s, d) => s + (d < 0 ? -d : 0), 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeBollinger(
  closes: number[],
  period = 20,
  stdDev = 2,
): [number, number, number] {
  if (closes.length < period) return [0, 0, 0];
  const recent = closes.slice(-period);
  const mid = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, x) => sum + (x - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return [mid - stdDev * std, mid, mid + stdDev * std];
}

export function generateSignals(closes: number[], lastPrice: number): string[] {
  const signals: string[] = [];
  const sma20 = computeSma(closes, 20);
  const sma50 = computeSma(closes, 50);
  const rsi = computeRsi(closes);
  const [bbLower, , bbUpper] = computeBollinger(closes);

  if (sma20 && sma50) {
    signals.push(
      sma20 > sma50
        ? "MA Crossover: SMA20 > SMA50 → BULLISH"
        : "MA Crossover: SMA20 < SMA50 → BEARISH",
    );
  }

  if (rsi < 30) {
    signals.push(`RSI(${rsi.toFixed(1)}): Oversold → BUY signal`);
  } else if (rsi > 70) {
    signals.push(`RSI(${rsi.toFixed(1)}): Overbought → SELL signal`);
  } else {
    signals.push(`RSI(${rsi.toFixed(1)}): Neutral`);
  }

  if (bbLower && bbUpper) {
    if (lastPrice < bbLower) {
      signals.push(`Bollinger: Price below lower band (${bbLower.toFixed(2)}) → BUY signal`);
    } else if (lastPrice > bbUpper) {
      signals.push(`Bollinger: Price above upper band (${bbUpper.toFixed(2)}) → SELL signal`);
    } else {
      signals.push(`Bollinger: Price within bands (${bbLower.toFixed(2)} - ${bbUpper.toFixed(2)})`);
    }
  }

  return signals;
}
