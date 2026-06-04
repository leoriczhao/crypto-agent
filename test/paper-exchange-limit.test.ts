import { describe, test, expect, vi, beforeEach } from "vitest";
import { PaperExchange } from "../src/exchange/paper.js";

// Stub out the LiveExchange fetchTicker so tests don't hit the network.
function stubTicker(paper: any, last: number) {
  paper.live.fetchTicker = vi.fn().mockResolvedValue({
    symbol: "BTC/USDT", last, bid: last, ask: last, volume: 0, timestamp: Date.now(),
  });
}

describe("PaperExchange — limit orders", () => {
  let paper: PaperExchange;
  beforeEach(() => {
    paper = new PaperExchange("okx", { USDT: 10000 });
    stubTicker(paper, 75000);
  });

  test("limit buy below market price rests as open", async () => {
    const order = await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    expect(order.status).toBe("open");
    const open = await paper.fetchOpenOrders();
    expect(open).toHaveLength(1);
    expect(open[0].price).toBe(70000);
  });

  test("limit buy in-the-money fills immediately", async () => {
    stubTicker(paper, 70000);
    const fills: any[] = [];
    paper.on("orderFilled", (o) => fills.push(o));

    const order = await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 72000);
    // 72000 ≥ 70000 (last), so limit buy at 72000 is immediately fillable
    expect(order.status).toBe("filled");
    expect(fills).toHaveLength(1);
    const open = await paper.fetchOpenOrders();
    expect(open).toHaveLength(0);
  });

  test("processTick fills limit when price crosses trigger", async () => {
    const order = await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    expect(order.status).toBe("open");
    const fills: any[] = [];
    paper.on("orderFilled", (o) => fills.push(o));

    paper.processTick("BTC/USDT", 72000); // above trigger — no fill
    expect(fills).toHaveLength(0);

    paper.processTick("BTC/USDT", 69999); // crossed
    expect(fills).toHaveLength(1);
    expect(fills[0].id).toBe(order.id);
    expect(fills[0].price).toBe(70000);
  });

  test("fill updates balances and position", async () => {
    await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    paper.processTick("BTC/USDT", 69999);

    const balance = await paper.fetchBalance();
    expect(balance.USDT.total).toBeCloseTo(10000 - 0.01 * 70000);
    expect(balance.BTC.total).toBeCloseTo(0.01);
  });

  test("cancelOrder removes the pending order", async () => {
    const order = await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    const result = await paper.cancelOrder(order.id, "BTC/USDT");
    expect(result.status).toBe("cancelled");
    const open = await paper.fetchOpenOrders();
    expect(open).toHaveLength(0);
  });

  test("cancelOrder on a filled order rejects", async () => {
    const order = await paper.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    paper.processTick("BTC/USDT", 69999);
    const result = await paper.cancelOrder(order.id, "BTC/USDT");
    expect(result.error).toMatch(/filled, cannot cancel/);
  });

  test("market order still fills immediately (regression)", async () => {
    const order = await paper.createOrder("BTC/USDT", "buy", "market", 0.01);
    expect(order.status).toBe("filled");
    expect(order.type).toBe("market");
  });

  test("limit sell above market rests until price rises", async () => {
    // Seed a BTC balance so sell can succeed
    await paper.createOrder("BTC/USDT", "buy", "market", 0.05);
    const order = await paper.createOrder("BTC/USDT", "sell", "limit", 0.01, 80000);
    expect(order.status).toBe("open");

    paper.processTick("BTC/USDT", 79000); // below trigger
    expect((await paper.fetchOpenOrders()).length).toBe(1);

    paper.processTick("BTC/USDT", 80500); // crossed
    expect((await paper.fetchOpenOrders()).length).toBe(0);
  });

  test("insufficient funds at fill time cancels the order", async () => {
    const poor = new PaperExchange("okx", { USDT: 100 });
    stubTicker(poor, 75000);
    const fills: any[] = [];
    const cancels: any[] = [];
    poor.on("orderFilled", (o) => fills.push(o));
    poor.on("orderCancelled", (o) => cancels.push(o));

    // Limit buy for $700 worth, only $100 balance
    await poor.createOrder("BTC/USDT", "buy", "limit", 0.01, 70000);
    poor.processTick("BTC/USDT", 69999);
    expect(fills).toHaveLength(0);
    expect(cancels).toHaveLength(1);
    expect(cancels[0].reason).toMatch(/Insufficient USDT/);
  });
});
