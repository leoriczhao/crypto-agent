import { registerTool } from "./registry.js";

registerTool(
  "assess_risk",
  "Assess portfolio risk: exposure, concentration, drawdown, and current risk limits.",
  { type: "object", properties: {} },
  async ({ exchange, config }) => {
    try {
      const balance = await exchange.fetchBalance();
      const usdtFree = balance.USDT?.total ?? 0;
      const initialUsdt = config.initialBalance.USDT ?? 10000;

      const positions: Record<string, any> = await exchange.fetchPositions();

      let totalExposure = 0;
      let largestPosition = 0;
      let largestSymbol = "N/A";

      for (const [sym, pos] of Object.entries(positions)) {
        const value = Math.abs((pos.amount ?? 0) * (pos.current_price ?? pos.avg_entry_price ?? 0));
        totalExposure += value;
        if (value > largestPosition) {
          largestPosition = value;
          largestSymbol = sym;
        }
      }

      const portfolioValue = usdtFree + totalExposure;
      const exposurePct = portfolioValue > 0 ? (totalExposure / portfolioValue) * 100 : 0;
      const concentrationPct = portfolioValue > 0 ? (largestPosition / portfolioValue) * 100 : 0;
      const drawdownPct = Math.max(0, initialUsdt > 0 ? ((initialUsdt - portfolioValue) / initialUsdt) * 100 : 0);

      const lines = [
        "Portfolio Risk Assessment",
        "=".repeat(40),
        `Portfolio Value:     $${portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        `Initial Balance:     $${initialUsdt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        `Cash (USDT):         $${usdtFree.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        "",
        `Total Exposure:      $${totalExposure.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${exposurePct.toFixed(1)}%)`,
        `Largest Position:    ${largestSymbol} ($${largestPosition.toLocaleString("en-US", { minimumFractionDigits: 2 })}, ${concentrationPct.toFixed(1)}%)`,
        `Drawdown from Peak:  ${drawdownPct.toFixed(1)}%`,
        "",
      ];

      if (exposurePct > 80) lines.push("\u26a0\ufe0f  HIGH RISK: Exposure exceeds 80% of portfolio");
      if (concentrationPct > 50) lines.push("\u26a0\ufe0f  CONCENTRATED: Single position > 50% of portfolio");
      if (drawdownPct > 20) lines.push("\u26a0\ufe0f  DRAWDOWN: Portfolio down > 20% from initial");
      if (!lines.some((l) => l.includes("\u26a0"))) lines.push("\u2705 Risk levels within normal parameters");

      lines.push(
        "",
        "Risk Limits (from config)",
        "=".repeat(40),
        `Paper Trading:       ${config.paperTrading ? "ON" : "OFF"}`,
        `Max Order Size:      $${config.maxOrderSizeUsdt.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT`,
        `Default Exchange:    ${config.defaultExchange}`,
        `Initial Balance:     $${(config.initialBalance.USDT ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT`,
      );

      return lines.join("\n");
    } catch (e: any) {
      return `Error in assess_risk: ${e.message ?? e}`;
    }
  },
);
