import pytest
from crypto_agent.tools.strategy import compute_sma, compute_rsi, compute_bollinger


def test_sma():
    closes = list(range(1, 21))  # 1 to 20
    assert compute_sma(closes, 20) == 10.5


def test_rsi_all_gains():
    closes = list(range(100, 115))  # all positive
    assert compute_rsi(closes) == 100.0


def test_rsi_all_losses():
    closes = list(range(114, 99, -1))  # all negative
    assert compute_rsi(closes) == 0.0


def test_bollinger():
    closes = [10.0] * 20  # flat line
    lower, mid, upper = compute_bollinger(closes)
    assert mid == 10.0
    assert lower == 10.0  # zero std dev
    assert upper == 10.0


def test_sma_insufficient_data():
    assert compute_sma([1, 2], 20) == 0.0
