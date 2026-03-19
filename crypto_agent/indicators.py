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


def generate_signals(closes: list[float], last_price: float) -> list[str]:
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
