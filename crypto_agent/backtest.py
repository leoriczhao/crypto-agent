from dataclasses import dataclass, field

from .indicators import compute_sma, compute_rsi, compute_bollinger


@dataclass
class BacktestResult:
    strategy: str
    symbol: str
    timeframe: str
    total_return: float
    max_drawdown: float
    sharpe_ratio: float
    win_rate: float
    total_trades: int
    trades: list[dict] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)


class BacktestEngine:
    def __init__(self, initial_capital: float = 10000.0):
        self.initial_capital = initial_capital

    def run(
        self,
        ohlcv: list[dict],
        strategy: str,
        params: dict | None = None,
        symbol: str = "",
        timeframe: str = "",
    ) -> BacktestResult:
        params = params or {}
        strategies = {
            "sma_crossover": self._run_sma_crossover,
            "rsi_reversal": self._run_rsi_reversal,
            "bollinger_bounce": self._run_bollinger_bounce,
        }
        if strategy not in strategies:
            raise ValueError(
                f"Unknown strategy: {strategy}. Available: {list(strategies.keys())}"
            )
        trades, equity = strategies[strategy](ohlcv, params)
        return self._build_result(strategy, symbol, timeframe, trades, equity)

    # -- Strategy runners --------------------------------------------------

    def _run_sma_crossover(
        self, ohlcv: list[dict], params: dict
    ) -> tuple[list[dict], list[float]]:
        short_period = params.get("short_period", 10)
        long_period = params.get("long_period", 30)
        closes = [bar["close"] for bar in ohlcv]

        cash = self.initial_capital
        position = 0.0
        trades: list[dict] = []
        equity: list[float] = []

        for i in range(long_period, len(closes)):
            price = closes[i]
            window = closes[: i + 1]
            short_sma = compute_sma(window, short_period)
            long_sma = compute_sma(window, long_period)

            if short_sma > long_sma and position == 0:
                qty = cash / price
                position = qty
                cash = 0.0
                trades.append(
                    {"side": "buy", "price": price, "quantity": qty, "index": i}
                )
            elif short_sma < long_sma and position > 0:
                cash = position * price
                trades.append(
                    {"side": "sell", "price": price, "quantity": position, "index": i}
                )
                position = 0.0

            equity.append(cash + position * price)

        self._close_open_position(closes, position, cash, trades, equity)
        return trades, equity

    def _run_rsi_reversal(
        self, ohlcv: list[dict], params: dict
    ) -> tuple[list[dict], list[float]]:
        period = params.get("period", 14)
        oversold = params.get("oversold", 30)
        overbought = params.get("overbought", 70)
        closes = [bar["close"] for bar in ohlcv]

        cash = self.initial_capital
        position = 0.0
        trades: list[dict] = []
        equity: list[float] = []

        for i in range(period + 1, len(closes)):
            price = closes[i]
            window = closes[: i + 1]
            rsi = compute_rsi(window, period)

            if rsi < oversold and position == 0:
                qty = cash / price
                position = qty
                cash = 0.0
                trades.append(
                    {"side": "buy", "price": price, "quantity": qty, "index": i}
                )
            elif rsi > overbought and position > 0:
                cash = position * price
                trades.append(
                    {"side": "sell", "price": price, "quantity": position, "index": i}
                )
                position = 0.0

            equity.append(cash + position * price)

        self._close_open_position(closes, position, cash, trades, equity)
        return trades, equity

    def _run_bollinger_bounce(
        self, ohlcv: list[dict], params: dict
    ) -> tuple[list[dict], list[float]]:
        period = params.get("period", 20)
        std_dev = params.get("std_dev", 2.0)
        closes = [bar["close"] for bar in ohlcv]

        cash = self.initial_capital
        position = 0.0
        trades: list[dict] = []
        equity: list[float] = []

        for i in range(period, len(closes)):
            price = closes[i]
            window = closes[: i + 1]
            lower, _mid, upper = compute_bollinger(window, period, std_dev)

            if price < lower and position == 0:
                qty = cash / price
                position = qty
                cash = 0.0
                trades.append(
                    {"side": "buy", "price": price, "quantity": qty, "index": i}
                )
            elif price > upper and position > 0:
                cash = position * price
                trades.append(
                    {"side": "sell", "price": price, "quantity": position, "index": i}
                )
                position = 0.0

            equity.append(cash + position * price)

        self._close_open_position(closes, position, cash, trades, equity)
        return trades, equity

    # -- Helpers -----------------------------------------------------------

    @staticmethod
    def _close_open_position(
        closes: list[float],
        position: float,
        cash: float,
        trades: list[dict],
        equity: list[float],
    ) -> None:
        if position > 0 and closes:
            final_price = closes[-1]
            cash = position * final_price
            trades.append(
                {
                    "side": "sell",
                    "price": final_price,
                    "quantity": position,
                    "index": len(closes) - 1,
                }
            )
            if equity:
                equity[-1] = cash

    def _build_result(
        self,
        strategy: str,
        symbol: str,
        timeframe: str,
        trades: list[dict],
        equity: list[float],
    ) -> BacktestResult:
        if equity:
            total_return = (
                (equity[-1] - self.initial_capital) / self.initial_capital
            ) * 100
        else:
            total_return = 0.0

        return BacktestResult(
            strategy=strategy,
            symbol=symbol,
            timeframe=timeframe,
            total_return=total_return,
            max_drawdown=self._calc_max_drawdown(equity),
            sharpe_ratio=self._calc_sharpe(equity),
            win_rate=self._calc_win_rate(trades),
            total_trades=len(trades),
            trades=trades,
            equity_curve=equity,
        )

    @staticmethod
    def _calc_max_drawdown(equity: list[float]) -> float:
        if not equity:
            return 0.0
        peak = equity[0]
        max_dd = 0.0
        for value in equity:
            if value > peak:
                peak = value
            dd = (peak - value) / peak * 100
            if dd > max_dd:
                max_dd = dd
        return max_dd

    @staticmethod
    def _calc_sharpe(equity: list[float]) -> float:
        if len(equity) < 2:
            return 0.0
        returns = [
            (equity[i] - equity[i - 1]) / equity[i - 1]
            for i in range(1, len(equity))
            if equity[i - 1] != 0
        ]
        if len(returns) < 2:
            return 0.0
        avg_ret = sum(returns) / len(returns)
        variance = sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1)
        std_ret = variance**0.5
        if std_ret == 0:
            return 0.0
        return (avg_ret / std_ret) * (252**0.5)

    @staticmethod
    def _calc_win_rate(trades: list[dict]) -> float:
        wins = 0
        total = 0
        for i in range(0, len(trades) - 1, 2):
            if trades[i]["side"] == "buy" and trades[i + 1]["side"] == "sell":
                if trades[i + 1]["price"] > trades[i]["price"]:
                    wins += 1
                total += 1
        return (wins / total * 100) if total > 0 else 0.0
