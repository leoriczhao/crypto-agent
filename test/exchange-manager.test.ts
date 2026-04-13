import { describe, test, expect } from "vitest";
import { ExchangeManager } from "../src/exchange/manager.js";
import type { BaseExchange } from "../src/exchange/base.js";

class FakeExchange implements BaseExchange {
  name: string;
  closed = false;

  constructor(name: string) {
    this.name = name;
  }

  async fetchTicker(symbol: string) {
    return { symbol, last: 100.0, bid: 99, ask: 101 };
  }
  async fetchOhlcv() {
    return [];
  }
  async fetchOrderBook() {
    return {};
  }
  async createOrder() {
    return {};
  }
  async cancelOrder() {
    return {};
  }
  async fetchBalance() {
    return {};
  }
  async fetchOpenOrders() {
    return [];
  }
  async fetchPositions() {
    return {};
  }
  async close() {
    this.closed = true;
  }
}

describe("ExchangeManager", () => {
  test("active exchange", () => {
    const mgr = new ExchangeManager();
    mgr.register("gateio", new FakeExchange("gateio"));
    mgr.register("okx", new FakeExchange("okx"));
    mgr.setActive("gateio");
    expect((mgr.active as any).name).toBe("gateio");
  });

  test("switch exchange", () => {
    const mgr = new ExchangeManager();
    mgr.register("gateio", new FakeExchange("gateio"));
    mgr.register("okx", new FakeExchange("okx"));
    mgr.setActive("gateio");
    mgr.setActive("okx");
    expect((mgr.active as any).name).toBe("okx");
  });

  test("list exchanges", () => {
    const mgr = new ExchangeManager();
    mgr.register("gateio", new FakeExchange("gateio"));
    mgr.register("okx", new FakeExchange("okx"));
    expect(mgr.list().sort()).toEqual(["gateio", "okx"]);
  });

  test("get specific exchange", () => {
    const mgr = new ExchangeManager();
    mgr.register("gateio", new FakeExchange("gateio"));
    expect((mgr.get("gateio") as any).name).toBe("gateio");
  });

  test("switch to unknown throws", () => {
    const mgr = new ExchangeManager();
    mgr.register("gateio", new FakeExchange("gateio"));
    expect(() => mgr.setActive("nonexistent")).toThrow();
  });

  test("close all exchanges", async () => {
    const mgr = new ExchangeManager();
    const ex1 = new FakeExchange("a");
    const ex2 = new FakeExchange("b");
    mgr.register("a", ex1);
    mgr.register("b", ex2);
    await mgr.closeAll();
    expect(ex1.closed).toBe(true);
    expect(ex2.closed).toBe(true);
  });
});
