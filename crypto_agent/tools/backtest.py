from .registry import register_tool


@register_tool(
    name="backtest",
    description=(
        "Backtest a trading strategy on historical data.\n"
        "Strategies: sma_crossover, rsi_reversal, bollinger_bounce\n"
        "Returns: total return, max drawdown, Sharpe ratio, win rate, trade count"
    ),
    schema={
        "type": "object",
        "properties": {
            "strategy": {
                "type": "string",
                "enum": ["sma_crossover", "rsi_reversal", "bollinger_bounce"],
            },
            "symbol": {"type": "string", "default": "BTC/USDT"},
            "timeframe": {"type": "string", "default": "1h"},
            "limit": {
                "type": "integer",
                "description": "Number of historical candles (max 500)",
                "default": 200,
            },
            "params": {
                "type": "object",
                "description": 'Strategy parameters, e.g. {"short_period": 10, "long_period": 30}',
            },
        },
        "required": ["strategy"],
    },
)
async def handle_backtest(
    exchange,
    strategy: str,
    symbol: str = "BTC/USDT",
    timeframe: str = "1h",
    limit: int = 200,
    params: dict | None = None,
    **_,
) -> str:
    from ..backtest import BacktestEngine

    try:
        limit = min(limit, 500)
        ohlcv = await exchange.fetch_ohlcv(symbol, timeframe, limit)
        if len(ohlcv) < 30:
            return f"Insufficient data: got {len(ohlcv)} candles, need at least 30."

        engine = BacktestEngine(initial_capital=10000.0)
        result = engine.run(ohlcv, strategy, params, symbol=symbol, timeframe=timeframe)

        lines = [
            f"Backtest Results: {strategy} on {symbol} ({timeframe})",
            "=" * 50,
            f"Period:          {len(ohlcv)} candles",
            f"Total Return:    {result.total_return:+.2f}%",
            f"Max Drawdown:    {result.max_drawdown:.2f}%",
            f"Sharpe Ratio:    {result.sharpe_ratio:.2f}",
            f"Win Rate:        {result.win_rate:.1f}%",
            f"Total Trades:    {result.total_trades}",
        ]

        if result.trades:
            lines.extend(["", "Last 5 trades:"])
            for t in result.trades[-5:]:
                lines.append(f"  {t['side'].upper():4s}  @ {t['price']:.2f}")

        if result.equity_curve:
            lines.extend([
                "",
                f"Starting Capital: $10,000.00",
                f"Final Value:      ${result.equity_curve[-1]:,.2f}",
            ])

        return "\n".join(lines)
    except Exception as e:
        return f"Backtest error: {e}"
