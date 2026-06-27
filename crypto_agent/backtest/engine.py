from __future__ import annotations

from crypto_agent.domain.strategy import BacktestReport, Candle, Condition, SignalStrategyDefinition


class BacktestEngine:
    def run_signal_strategy(
        self,
        definition: SignalStrategyDefinition,
        candles: list[Candle],
    ) -> BacktestReport:
        closes = [candle.close for candle in candles]
        in_position = False
        entry_price = 0.0
        entry_time = ""
        trades: list[dict[str, float | str]] = []

        for index, candle in enumerate(candles):
            if not in_position and self._conditions_met(definition.entry_conditions, candles, closes, index):
                in_position = True
                entry_price = candle.close
                entry_time = candle.timestamp
                continue

            if in_position and self._conditions_met(definition.exit_conditions, candles, closes, index):
                pnl = candle.close - entry_price
                trades.append(
                    {
                        "entry_time": entry_time,
                        "exit_time": candle.timestamp,
                        "entry_price": entry_price,
                        "exit_price": candle.close,
                        "realized_pnl": pnl,
                    }
                )
                in_position = False

        realized_pnl = sum(float(trade["realized_pnl"]) for trade in trades)
        metrics: dict[str, float | int] = {
            "trade_count": len(trades),
            "realized_pnl": realized_pnl,
        }
        status = "passed" if trades else "failed"
        return BacktestReport(status=status, metrics=metrics, trades=trades)

    def _conditions_met(
        self,
        conditions: list[Condition],
        candles: list[Candle],
        closes: list[float],
        index: int,
    ) -> bool:
        return all(self._evaluate_condition(condition, candles, closes, index) for condition in conditions)

    def _evaluate_condition(
        self,
        condition: Condition,
        candles: list[Candle],
        closes: list[float],
        index: int,
    ) -> bool:
        value = self._indicator_value(condition, candles, closes, index)
        if value is None:
            return False
        return _compare(value, condition.operator, condition.value)

    def _indicator_value(
        self,
        condition: Condition,
        candles: list[Candle],
        closes: list[float],
        index: int,
    ) -> float | None:
        indicator = condition.indicator.lower()
        if indicator == "price":
            return candles[index].close
        if indicator == "sma":
            period = condition.period or 14
            return _sma(closes, index, period)
        if indicator == "rsi":
            period = condition.period or 14
            return _rsi(closes, index, period)
        if indicator == "bollinger_upper":
            period = condition.period or 20
            band = _bollinger(closes, index, period)
            return band[2] if band else None
        if indicator == "bollinger_middle":
            period = condition.period or 20
            band = _bollinger(closes, index, period)
            return band[1] if band else None
        if indicator == "bollinger_lower":
            period = condition.period or 20
            band = _bollinger(closes, index, period)
            return band[0] if band else None
        raise ValueError(f"unsupported indicator: {condition.indicator}")


def _compare(left: float, operator: str, right: float) -> bool:
    if operator == ">":
        return left > right
    if operator == ">=":
        return left >= right
    if operator == "<":
        return left < right
    if operator == "<=":
        return left <= right
    if operator == "==":
        return left == right
    if operator == "!=":
        return left != right
    raise ValueError(f"unsupported operator: {operator}")


def _sma(values: list[float], index: int, period: int) -> float | None:
    if period <= 0:
        raise ValueError("period must be positive")
    if index + 1 < period:
        return None
    window = values[index + 1 - period : index + 1]
    return sum(window) / period


def _rsi(values: list[float], index: int, period: int) -> float | None:
    if period <= 0:
        raise ValueError("period must be positive")
    if index < period:
        return None
    gains = 0.0
    losses = 0.0
    for cursor in range(index + 1 - period, index + 1):
        delta = values[cursor] - values[cursor - 1]
        if delta >= 0:
            gains += delta
        else:
            losses += abs(delta)
    if losses == 0:
        return 100.0
    relative_strength = gains / losses
    return 100 - (100 / (1 + relative_strength))


def _bollinger(values: list[float], index: int, period: int) -> tuple[float, float, float] | None:
    middle = _sma(values, index, period)
    if middle is None:
        return None
    window = values[index + 1 - period : index + 1]
    variance = sum((value - middle) ** 2 for value in window) / period
    stddev = variance**0.5
    return middle - 2 * stddev, middle, middle + 2 * stddev
