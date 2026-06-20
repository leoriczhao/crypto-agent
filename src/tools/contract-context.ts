import type { ExchangeMarginMode, ExchangePositionSide } from "../exchange/base.js";

export type ContractSide = "long" | "short";

export function contractOrderSide(side: ContractSide, reduceOnly = false): "buy" | "sell" {
  if (side === "long") return reduceOnly ? "sell" : "buy";
  return reduceOnly ? "buy" : "sell";
}

export function contractMarginMode(config: any): ExchangeMarginMode {
  return config?.contractMarginMode === "cross" ? "cross" : "isolated";
}

export function contractPositionSide(config: any, side: ContractSide): ExchangePositionSide {
  return config?.contractPositionMode === "hedge" ? side : "net";
}

export function contractMaxLeverage(config: any): number {
  return Number(config?.contractMaxLeverage ?? config?.paperMaxLeverage ?? 5);
}
