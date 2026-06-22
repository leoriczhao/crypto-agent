import { describe, test, expect } from "vitest";
import {
  compileStrategyPackage,
  assertPackageDeployable,
} from "../src/strategy/package-compiler.js";
import type { StrategyPackageRow } from "../src/memory.js";

function packageRow(patch: Partial<StrategyPackageRow> = {}): StrategyPackageRow {
  return {
    id: "btc_eth_signal",
    version: 1,
    familyId: "btc_eth_signal",
    name: "BTC/ETH Signal",
    status: "paper_ready",
    authorAgentId: null,
    authorRunId: null,
    source: "test",
    mandate: { thesis: "Trend signal" },
    executableSpec: {
      kind: "signal",
      symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
      timeframe: "15m",
      side: "long",
      entry: [{ indicator: "rsi", operator: "lt", value: 35 }],
      exit: [{ indicator: "rsi", operator: "gt", value: 60 }],
      positionSizeUsdt: 50,
      stopLossPct: 1.5,
      takeProfitPct: 3,
    },
    riskPolicy: {
      maxLeverage: 3,
      maxSingleNotionalUsdt: 100,
      maxTotalNotionalUsdt: 300,
    },
    validationStatus: "waived",
    validationSummary: "paper waiver",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    ...patch,
  };
}

describe("strategy package compiler", () => {
  test("compiles a multi-symbol signal package into one instance per symbol", () => {
    const instances = compileStrategyPackage({
      package: packageRow(),
      deploymentId: "dep-1",
      botId: "bot-1",
      tradingAccountId: "acct-1",
      allocatedUsdt: 300,
    });

    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.symbol)).toEqual(["BTC/USDT:USDT", "ETH/USDT:USDT"]);
    expect(instances[0]).toMatchObject({
      id: "dep-1:btc-usdt-usdt",
      deploymentId: "dep-1",
      packageId: "btc_eth_signal",
      packageVersion: 1,
      kind: "signal",
      allocatedUsdt: 150,
      botId: "bot-1",
      tradingAccountId: "acct-1",
    });
    expect(instances[0].params).toMatchObject({
      timeframe: "15m",
      side: "long",
      positionSizeUsdt: 50,
      stopLossPct: 1.5,
      takeProfitPct: 3,
    });
  });

  test("compiles a grid package into one grid instance", () => {
    const instances = compileStrategyPackage({
      package: packageRow({
        id: "eth_grid",
        familyId: "eth_grid",
        executableSpec: {
          kind: "grid",
          symbol: "ETH/USDT:USDT",
          side: "long",
          lowerPrice: 1600,
          upperPrice: 1900,
          gridCount: 6,
          sizePerGrid: 20,
        },
        riskPolicy: { maxLeverage: 1, maxSingleNotionalUsdt: 20, maxTotalNotionalUsdt: 120 },
      }),
      deploymentId: "dep-grid",
      botId: "bot-1",
      tradingAccountId: "acct-1",
      allocatedUsdt: 120,
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      id: "dep-grid:eth-usdt-usdt",
      kind: "grid",
      symbol: "ETH/USDT:USDT",
      allocatedUsdt: 120,
      params: {
        side: "long",
        lowerPrice: 1600,
        upperPrice: 1900,
        gridCount: 6,
        sizePerGrid: 20,
      },
    });
  });

  test("rejects unsupported executable kinds and malformed grid symbols", () => {
    expect(() => compileStrategyPackage({
      package: packageRow({ executableSpec: { kind: "unknown" } }),
      deploymentId: "dep-1",
      botId: "bot-1",
      tradingAccountId: "acct-1",
    })).toThrow(/Unsupported strategy package kind/);

    expect(() => compileStrategyPackage({
      package: packageRow({
        executableSpec: {
          kind: "grid",
          symbols: ["BTC/USDT:USDT", "ETH/USDT:USDT"],
          side: "long",
          lowerPrice: 100,
          upperPrice: 200,
          gridCount: 3,
          sizePerGrid: 10,
        },
      }),
      deploymentId: "dep-1",
      botId: "bot-1",
      tradingAccountId: "acct-1",
    })).toThrow(/grid package requires exactly one symbol/);
  });

  test("enforces paper and live deployment policy", () => {
    expect(() => assertPackageDeployable(packageRow(), "PAPER")).not.toThrow();

    expect(() => assertPackageDeployable(packageRow(), "LIVE")).toThrow(/live_ready/);
    expect(() => assertPackageDeployable(packageRow({
      status: "live_ready",
      validationStatus: "waived",
    }), "LIVE")).toThrow(/passed validation/);
    expect(() => assertPackageDeployable(packageRow({
      status: "live_ready",
      validationStatus: "passed",
    }), "LIVE")).not.toThrow();
  });
});
