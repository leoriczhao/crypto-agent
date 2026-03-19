from .registry import register_tool
from ..indicators import compute_sma, compute_rsi, compute_bollinger, generate_signals


@register_tool(
    name="analyze",
    description="Technical analysis for a symbol: SMA, RSI, Bollinger Bands, and buy/sell signals.",
    schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Trading pair, e.g. BTC/USDT", "default": "BTC/USDT"},
            "timeframe": {"type": "string", "description": "Candle interval", "default": "1h"},
        },
        "required": [],
    },
)
async def handle_analyze(exchange, symbol: str = "BTC/USDT", timeframe: str = "1h", **_) -> str:
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

        signals = generate_signals(closes, last_price)
        lines.extend(["", f"Trading Signals:", f"{'=' * 45}"])
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
    except Exception as e:
        return f"Error in analyze: {e}"
