export const HEARTBEAT_PROMPT = `[HEARTBEAT {timestamp}]
This is an automatic heartbeat check. Review the current state:
1. Check if any positions need attention (stop-loss, take-profit)
2. Check for any significant price movements
3. Check if any scheduled tasks are due

If nothing needs attention, respond briefly with "All clear."
If action is needed, take it and report what you did.
`;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class HeartbeatScheduler {
  private agent: any;
  private interval: number;
  private sessionId: string;
  private onResponse: ((msg: string) => Promise<void>) | null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  constructor(
    agent: any,
    interval = 60,
    sessionId: string,
    onResponse: ((msg: string) => Promise<void>) | null = null,
  ) {
    this.agent = agent;
    this.interval = interval;
    this.sessionId = sessionId;
    this.onResponse = onResponse;
  }

  async start(): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();
    this.loopPromise = this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await sleep(this.interval * 1000, this.abortController?.signal);
      if (!this.running) break;
      try {
        const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
        const prompt = HEARTBEAT_PROMPT.replace("{timestamp}", timestamp);
        const response: string = await this.agent.chatInSession(this.sessionId, prompt);
        if (this.onResponse) {
          await this.onResponse(`[Heartbeat] ${response}`);
        }
      } catch (e: any) {
        if (this.onResponse) {
          await this.onResponse(`[Heartbeat error] ${e.message ?? e}`);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
    }
    this.abortController = null;
  }
}
