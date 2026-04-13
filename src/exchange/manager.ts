import type { BaseExchange } from "./base.js";

export class ExchangeManager {
  private exchanges: Record<string, BaseExchange> = {};
  private _activeId: string | null = null;

  register(exchangeId: string, exchange: BaseExchange): void {
    this.exchanges[exchangeId] = exchange;
    if (this._activeId === null) {
      this._activeId = exchangeId;
    }
  }

  get active(): BaseExchange {
    if (!this._activeId || !(this._activeId in this.exchanges)) {
      throw new Error("No active exchange. Register one first.");
    }
    return this.exchanges[this._activeId];
  }

  get activeId(): string {
    return this._activeId ?? "";
  }

  setActive(exchangeId: string): void {
    if (!(exchangeId in this.exchanges)) {
      throw new Error(
        `Exchange '${exchangeId}' not registered. Available: ${Object.keys(this.exchanges).join(", ")}`,
      );
    }
    this._activeId = exchangeId;
  }

  get(exchangeId: string): BaseExchange {
    if (!(exchangeId in this.exchanges)) {
      throw new Error(`Exchange '${exchangeId}' not registered.`);
    }
    return this.exchanges[exchangeId];
  }

  list(): string[] {
    return Object.keys(this.exchanges);
  }

  async closeAll(): Promise<void> {
    for (const ex of Object.values(this.exchanges)) {
      await ex.close();
    }
  }
}
