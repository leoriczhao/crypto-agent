import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";
import { IpcServer, type IpcServerHandlers } from "../src/ipc/server.js";
import { IpcClient } from "../src/ipc/client.js";

/**
 * End-to-end tests that spin up a real Unix-socket IPC server + client in the
 * same process and verify message round-trips, event broadcasts, and
 * disconnect handling.
 */

function uniqueSocketPath(): string {
  return join(tmpdir(), `crypto-ipc-test-${randomUUID().slice(0, 8)}.sock`);
}

function makeHandlers(overrides: Partial<IpcServerHandlers> = {}): IpcServerHandlers {
  return {
    onChat: async (_session, content, _rid, onDelta) => {
      onDelta(`echo: ${content.slice(0, 10)}`);
      return `echo: ${content}`;
    },
    onSlash: async (command) => ({ text: `ran: ${command}` }),
    onListSessions: () => ({
      sessions: [
        { id: "sess-1", name: "user", type: "user", messageCount: 5, lastActiveAt: new Date().toISOString() },
      ],
      activeId: "sess-1",
    }),
    onStatus: async () => ({
      activeRules: 2,
      openPositions: 1,
      fastPath: "running",
      snapshot: "Mode: PAPER\nUSDT: $10000",
    }),
    describe: () => ({
      mode: "PAPER",
      exchange: "gateio",
      soul: "balanced",
      heartbeatInterval: 60,
      fastPath: "idle",
    }),
    ...overrides,
  };
}

describe("IPC end-to-end", () => {
  let server: IpcServer;
  let client: IpcClient;
  let path: string;

  beforeEach(async () => {
    path = uniqueSocketPath();
    process.env.CRYPTO_AGENT_SOCK = path;
    server = new IpcServer(makeHandlers());
    await server.start();
    client = new IpcClient({ path, reconnectDelayMs: 100 });
  });

  afterEach(async () => {
    client.close();
    await server.stop("test teardown");
    if (existsSync(path)) try { unlinkSync(path); } catch {}
    delete process.env.CRYPTO_AGENT_SOCK;
  });

  test("client receives welcome on connect", async () => {
    const welcomePromise = new Promise<any>((resolve) => client.once("connected", resolve));
    await client.connect();
    const welcome = await welcomePromise;
    expect(welcome.type).toBe("welcome");
    expect(welcome.mode).toBe("PAPER");
    expect(welcome.exchange).toBe("gateio");
    expect(welcome.soul).toBe("balanced");
  });

  test("chat request round-trips with delta callback", async () => {
    await client.connect();
    const deltas: string[] = [];
    const final = await client.chat("user", "hello world", {
      onDelta: (t) => deltas.push(t),
    });
    expect(final).toBe("echo: hello world");
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas[0]).toContain("echo:");
  });

  test("cancel aborts an in-flight chat request", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let observedSignal: AbortSignal | undefined;

    await server.stop();
    server = new IpcServer(makeHandlers({
      onChat: async (_session, _content, _rid, onDelta, _onToolUse, signal) => {
        observedSignal = signal;
        onDelta("partial");
        started();
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("handler aborted")), { once: true });
        });
        return "should not complete";
      },
    }));
    await server.start();

    await client.connect();
    const handle = client.startChat("user", "slow request");
    await startedPromise;
    client.cancel(handle.requestId);

    await expect(handle.promise).rejects.toThrow("Cancelled");
    expect(observedSignal?.aborted).toBe(true);
  });

  test("slash command returns text", async () => {
    await client.connect();
    const result = await client.slash("/sessions");
    expect(result).toBe("ran: /sessions");
  });

  test("list sessions returns the server's list", async () => {
    await client.connect();
    const list = await client.listSessions();
    expect(list.type).toBe("sessions_list");
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0].name).toBe("user");
    expect(list.activeId).toBe("sess-1");
  });

  test("status returns snapshot + engine state", async () => {
    await client.connect();
    const status = await client.status();
    expect(status.type).toBe("status_snapshot");
    expect(status.activeRules).toBe(2);
    expect(status.openPositions).toBe(1);
    expect(status.fastPath).toBe("running");
    expect(status.snapshot).toContain("PAPER");
  });

  test("server broadcasts events to all connected clients", async () => {
    const client2 = new IpcClient({ path, reconnectDelayMs: 100 });
    const events1: any[] = [];
    const events2: any[] = [];
    client.on("event", (e) => events1.push(e));
    client2.on("event", (e) => events2.push(e));

    await client.connect();
    await client2.connect();

    server.broadcast({
      type: "event",
      kind: "trade_entered",
      data: { symbol: "BTC/USDT", side: "long", entryPrice: 50000, sizeUsdt: 500 },
      timestamp: Date.now(),
    });

    // Give the event loop a tick to deliver
    await new Promise((r) => setTimeout(r, 50));

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0].kind).toBe("trade_entered");
    expect(events2[0].kind).toBe("trade_entered");

    client2.close();
  });

  test("handler errors are returned as error messages", async () => {
    await server.stop();
    server = new IpcServer(makeHandlers({
      onSlash: async () => { throw new Error("boom"); },
    }));
    await server.start();

    await client.connect();
    await expect(client.slash("/anything")).rejects.toThrow("boom");
  });

  test("client auto-reconnects after server restart", async () => {
    await client.connect();
    const reconnects: any[] = [];
    client.on("connected", (w) => reconnects.push(w));

    // Shut the server down; client should reconnect when server is back
    await server.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(false);

    // Bring server back on the same path
    server = new IpcServer(makeHandlers());
    await server.start();

    // Wait for the client's reconnect loop (delay = 100ms)
    await new Promise((r) => setTimeout(r, 500));
    expect(client.isConnected()).toBe(true);
    expect(reconnects.length).toBeGreaterThanOrEqual(1);
  });

  test("shutdown_notice reaches client", async () => {
    await client.connect();
    const shutdownPromise = new Promise<string>((resolve) => client.once("shutdown", resolve));
    await server.stop("test shutdown");
    const reason = await shutdownPromise;
    expect(reason).toBe("test shutdown");
  });
});
