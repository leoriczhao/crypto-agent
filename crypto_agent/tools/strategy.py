import json
from .registry import register_tool


def compute_sma(closes: list[float], period: int) -> float:
    if len(closes) < period:
        return 0.0
    return sum(closes[-period:]) / period


def compute_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def compute_bollinger(closes: list[float], period: int = 20, std_dev: float = 2.0) -> tuple[float, float, float]:
    if len(closes) < period:
        return 0.0, 0.0, 0.0
    recent = closes[-period:]
    mid = sum(recent) / period
    variance = sum((x - mid) ** 2 for x in recent) / period
    std = variance ** 0.5
    return mid - std_dev * std, mid, mid + std_dev * std


def _generate_signals(closes: list[float], last_price: float) -> list[str]:
    signals = []
    sma20 = compute_sma(closes, 20)
    sma50 = compute_sma(closes, 50)
    rsi = compute_rsi(closes)
    bb_lower, bb_mid, bb_upper = compute_bollinger(closes)

    if sma20 and sma50:
        if sma20 > sma50:
            signals.append("MA Crossover: SMA20 > SMA50 → BULLISH")
        else:
            signals.append("MA Crossover: SMA20 < SMA50 → BEARISH")

    if rsi < 30:
        signals.append(f"RSI({rsi:.1f}): Oversold → BUY signal")
    elif rsi > 70:
        signals.append(f"RSI({rsi:.1f}): Overbought → SELL signal")
    else:
        signals.append(f"RSI({rsi:.1f}): Neutral")

    if bb_lower and bb_upper:
        if last_price < bb_lower:
            signals.append(f"Bollinger: Price below lower band ({bb_lower:.2f}) → BUY signal")
        elif last_price > bb_upper:
            signals.append(f"Bollinger: Price above upper band ({bb_upper:.2f}) → SELL signal")
        else:
            signals.append(f"Bollinger: Price within bands ({bb_lower:.2f} - {bb_upper:.2f})")

    return signals


@register_tool(
    name="strategy",
    description=(
        "Quantitative strategy analysis.\n"
        "- analyze: technical analysis with SMA, RSI, Bollinger Bands\n"
        "- signals: buy/sell signals from indicator rules"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["analyze", "signals"]},
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT", "default": "BTC/USDT"},
            "timeframe": {"type": "string", "description": "Kline interval", "default": "1h"},
        },
        "required": ["action"],
    },
)
async def handle_strategy(exchange, action: str, symbol: str = "BTC/USDT", timeframe: str = "1h", **_) -> str:
    try:
        klines = await exchange.fetch_ohlcv(symbol, timeframe, 100)
        closes = [k["close"] if isinstance(k, dict) else k[4] for k in klines]

        if len(closes) < 2:
            return f"Insufficient data for {symbol} ({len(closes)} candles)."

        last_price = closes[-1]
        sma20 = compute_sma(closes, 20)
        sma50 = compute_sma(closes, 50)
        rsi = compute_rsi(closes)
        bb_lower, bb_mid, bb_upper = compute_bollinger(closes)

        if action == "analyze":
            lines = [
                f"Technical Analysis: {symbol} ({timeframe})",
                f"{'=' * 45}",
                f"Last Price: {last_price:.2f}",
                "",
                "Moving Averages:",
                f"  SMA(20):  {sma20:.2f}" + (" ⚠️ insufficient data" if sma20 == 0 else ""),
                f"  SMA(50):  {sma50:.2f}" + (" ⚠️ insufficient data" if sma50 == 0 else ""),
                "",
                f"RSI(14):    {rsi:.1f}" + (" [Oversold]" if rsi < 30 else " [Overbought]" if rsi > 70 else " [Neutral]"),
                "",
                "Bollinger Bands(20, 2):",
                f"  Upper:  {bb_upper:.2f}",
                f"  Middle: {bb_mid:.2f}",
                f"  Lower:  {bb_lower:.2f}",
            ]
            if sma20 and sma50:
                trend = "BULLISH" if sma20 > sma50 else "BEARISH"
                lines.extend(["", f"Trend: {trend} (SMA20 {'>' if sma20 > sma50 else '<'} SMA50)"])
            return "\n".join(lines)

        elif action == "signals":
            signals = _generate_signals(closes, last_price)
            lines = [f"Trading Signals: {symbol} ({timeframe})", f"{'=' * 45}"]
            for sig in signals:
                lines.append(f"  • {sig}")

            buy_count = sum(1 for s in signals if "BUY" in s or "BULLISH" in s)
            sell_count = sum(1 for s in signals if "SELL" in s or "BEARISH" in s)
            if buy_count > sell_count:
                lines.append(f"\nOverall: BULLISH ({buy_count} buy vs {sell_count} sell)")
            elif sell_count > buy_count:
                lines.append(f"\nOverall: BEARISH ({sell_count} sell vs {buy_count} buy)")
            else:
                lines.append("\nOverall: NEUTRAL")
            return "\n".join(lines)

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error in strategy: {e}"
