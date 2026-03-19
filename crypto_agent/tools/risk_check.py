from .registry import register_tool


@register_tool(
    name="risk_check",
    description=(
        "Portfolio risk management.\n"
        "- assess: evaluate current exposure, concentration, and drawdown\n"
        "- limits: show current risk parameters from config"
    ),
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["assess", "limits"]},
        },
        "required": ["action"],
    },
)
async def handle_risk_check(exchange, config, action: str, **_) -> str:
    try:
        if action == "assess":
            balance = await exchange.fetch_balance()
            usdt_free = balance.get("USDT", {}).get("total", 0)
            initial_usdt = config.initial_balance.get("USDT", 10000.0)

            positions = {}
            if hasattr(exchange, "fetch_positions"):
                positions = await exchange.fetch_positions()

            total_exposure = 0.0
            largest_position = 0.0
            largest_symbol = "N/A"

            for sym, pos in positions.items():
                value = abs(pos.get("amount", 0) * pos.get("current_price", pos.get("avg_entry_price", 0)))
                total_exposure += value
                if value > largest_position:
                    largest_position = value
                    largest_symbol = sym

            portfolio_value = usdt_free + total_exposure
            exposure_pct = (total_exposure / portfolio_value * 100) if portfolio_value > 0 else 0
            concentration_pct = (largest_position / portfolio_value * 100) if portfolio_value > 0 else 0
            drawdown_pct = ((initial_usdt - portfolio_value) / initial_usdt * 100) if initial_usdt > 0 else 0
            drawdown_pct = max(drawdown_pct, 0)

            lines = [
                "Portfolio Risk Assessment",
                "=" * 40,
                f"Portfolio Value:     ${portfolio_value:,.2f}",
                f"Initial Balance:     ${initial_usdt:,.2f}",
                f"Cash (USDT):         ${usdt_free:,.2f}",
                "",
                f"Total Exposure:      ${total_exposure:,.2f} ({exposure_pct:.1f}%)",
                f"Largest Position:    {largest_symbol} (${largest_position:,.2f}, {concentration_pct:.1f}%)",
                f"Drawdown from Peak:  {drawdown_pct:.1f}%",
                "",
            ]

            if exposure_pct > 80:
                lines.append("⚠️  HIGH RISK: Exposure exceeds 80% of portfolio")
            if concentration_pct > 50:
                lines.append("⚠️  CONCENTRATED: Single position > 50% of portfolio")
            if drawdown_pct > 20:
                lines.append("⚠️  DRAWDOWN: Portfolio down > 20% from initial")
            if not any("⚠️" in l for l in lines):
                lines.append("✅ Risk levels within normal parameters")

            return "\n".join(lines)

        elif action == "limits":
            lines = [
                "Risk Limits (from config)",
                "=" * 40,
                f"Paper Trading:       {'ON' if config.paper_trading else 'OFF'}",
                f"Max Order Size:      ${config.max_order_size_usdt:,.2f} USDT",
                f"Default Exchange:    {config.default_exchange}",
                f"Initial Balance:     ${config.initial_balance.get('USDT', 0):,.2f} USDT",
            ]
            return "\n".join(lines)

        return f"Unknown action: {action}"
    except Exception as e:
        return f"Error in risk_check: {e}"
