import math

import pytest

from crypto_agent.backtest import BacktestEngine, BacktestResult


def _make_ohlcv(closes: list[float]) -> list[dict]:
    return [
        {
            "timestamp": i * 3600000,
            "open": c,
            "high": c * 1.01,
            "low": c * 0.99,
            "close": c,
            "volume": 1000,
        }
        for i, c in enumerate(closes)
    ]


def test_backtest_result_type():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = [100 + i * 0.5 for i in range(60)]
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "sma_crossover", {"short_period": 5, "long_period": 20})
    assert isinstance(result, BacktestResult)


def test_backtest_sma_crossover_uptrend():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = [100 + i * 0.5 for i in range(60)]
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "sma_crossover", {"short_period": 5, "long_period": 20})
    assert result.total_trades >= 1
    assert result.total_return > 0
    assert len(result.equity_curve) > 0


def test_backtest_rsi_reversal():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = []
    for _cycle in range(4):
        closes.extend([100 - i * 2 for i in range(15)])
        closes.extend([70 + i * 2 for i in range(15)])
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "rsi_reversal")
    assert isinstance(result, BacktestResult)
    assert len(result.equity_curve) > 0


def test_backtest_bollinger_bounce():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = [100 + 10 * math.sin(i * 0.3) for i in range(100)]
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "bollinger_bounce")
    assert isinstance(result, BacktestResult)


def test_backtest_unknown_strategy():
    engine = BacktestEngine()
    with pytest.raises(ValueError, match="Unknown strategy"):
        engine.run([], "nonexistent")


def test_backtest_max_drawdown():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = list(range(100, 200)) + list(range(200, 100, -1))
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "sma_crossover", {"short_period": 5, "long_period": 20})
    assert result.max_drawdown >= 0
    assert result.max_drawdown <= 100


def test_backtest_sharpe_ratio():
    engine = BacktestEngine(initial_capital=10000.0)
    closes = [100 + i * 0.5 for i in range(60)]
    ohlcv = _make_ohlcv(closes)
    result = engine.run(ohlcv, "sma_crossover", {"short_period": 5, "long_period": 20})
    assert isinstance(result.sharpe_ratio, float)
