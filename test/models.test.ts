import { describe, test, expect } from "vitest";
import { Order, Position, Side, OrderType, OrderStatus } from "../src/models.js";

describe("Order", () => {
  test("toDict returns correct fields", () => {
    const order = new Order({
      id: "abc",
      symbol: "BTC/USDT",
      side: Side.BUY,
      orderType: OrderType.MARKET,
      amount: 0.1,
      filledPrice: 50000.0,
      status: OrderStatus.FILLED,
    });
    const d = order.toDict();
    expect(d.side).toBe("buy");
    expect(d.type).toBe("market");
    expect(d.status).toBe("filled");
    expect(d.amount).toBe(0.1);
  });
});

describe("Position", () => {
  test("unrealizedPnl positive", () => {
    const pos = new Position({
      symbol: "BTC/USDT",
      amount: 1.0,
      avgEntryPrice: 50000.0,
      currentPrice: 55000.0,
    });
    expect(pos.unrealizedPnl).toBe(5000.0);
    expect(pos.pnlPercent).toBe(10.0);
  });

  test("unrealizedPnl negative", () => {
    const pos = new Position({
      symbol: "ETH/USDT",
      amount: 2.0,
      avgEntryPrice: 3000.0,
      currentPrice: 2700.0,
    });
    expect(pos.unrealizedPnl).toBe(-600.0);
  });

  test("pnlPercent zero entry price", () => {
    const pos = new Position({
      symbol: "X/USDT",
      amount: 1.0,
      avgEntryPrice: 0.0,
    });
    expect(pos.pnlPercent).toBe(0.0);
  });
});
