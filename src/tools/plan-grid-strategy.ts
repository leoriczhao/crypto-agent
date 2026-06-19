import { registerTool } from "./registry.js";
import { checkBotFreeUsdt } from "./trading-context.js";

registerTool(
  "plan_grid_strategy",
  "Create a long-only price-grid strategy.\nBest for CHOPPY / RANGE-BOUND markets — the grid eats price oscillations between lowerPrice and upperPrice.\n\nMechanics:\n  - Uniform N levels between lowerPrice and upperPrice.\n  - At each level: resting limit buy. When buy fills, a limit sell goes on one grid spacing above. When that sell fills, buy is replaced at the original level. Rinse, repeat.\n  - No indicator evaluation — pure price-action based.\n\n⚠️ allocated_usdt MUST be >= grid_count × size_per_grid (the max simultaneous exposure if all buys fill). Strategy abort if under-funded.\n⚠️ Don't deploy on trending markets — buys stack on the way down and the grid becomes a heavy bag.",
  {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Trading pair, e.g. BTC/USDT" },
      lower_price: { type: "number", description: "Bottom of the grid range" },
      upper_price: { type: "number", description: "Top of the grid range" },
      grid_count: {
        type: "integer",
        description: "Number of grid levels (>=2). Spacing = (upper - lower) / (count - 1).",
      },
      size_per_grid: { type: "number", description: "USDT notional per level on each entry" },
      allocated_usdt: {
        type: "number",
        description: "Total budget. MUST be >= grid_count × size_per_grid.",
      },
      enabled: { type: "boolean", default: true },
    },
    required: ["symbol", "lower_price", "upper_price", "grid_count", "size_per_grid", "allocated_usdt"],
  },
  ["strategy_store", "memory", "sessionId"],
  async ({
    strategy_store,
    memory,
    sessionId,
    symbol,
    lower_price,
    upper_price,
    grid_count,
    size_per_grid,
    allocated_usdt,
    enabled = true,
  }) => {
    try {
      if (!strategy_store) return "Error: strategy manager not initialized";
      if (upper_price <= lower_price) {
        return `Error: upper_price (${upper_price}) must be > lower_price (${lower_price})`;
      }
      if (grid_count < 2) return `Error: grid_count (${grid_count}) must be >= 2`;
      const required = grid_count * size_per_grid;
      if (allocated_usdt < required) {
        return `Error: allocated_usdt ($${allocated_usdt}) < grid_count × size_per_grid ($${required}). All buys filling at once would exceed budget.`;
      }
      const botAllocationError = checkBotFreeUsdt(memory, sessionId, allocated_usdt);
      if (botAllocationError) return botAllocationError;

      const spacing = (upper_price - lower_price) / (grid_count - 1);
      const strat = strategy_store.addStrategy({
        kind: "grid",
        symbol,
        params: {
          side: "long",
          lowerPrice: lower_price,
          upperPrice: upper_price,
          gridCount: grid_count,
          sizePerGrid: size_per_grid,
        },
        allocatedUsdt: allocated_usdt,
        enabled,
      });

      const spread = ((spacing / lower_price) * 100).toFixed(2);
      return [
        `Grid strategy created: ${strat.id.slice(0, 8)}… [kind=grid]`,
        `  Symbol: ${symbol}`,
        `  Range: $${lower_price} – $${upper_price}  (${grid_count} levels, spacing $${spacing.toFixed(2)} ≈ ${spread}%)`,
        `  Size per level: $${size_per_grid}  |  Max exposure: $${required}  |  Allocated: $${allocated_usdt}`,
        `  Enabled: ${enabled}`,
        "  Runtime places buy limits on levels below current market on first tick.",
      ].join("\n");
    } catch (e: any) {
      return `Error: ${e.message ?? e}`;
    }
  },
);
