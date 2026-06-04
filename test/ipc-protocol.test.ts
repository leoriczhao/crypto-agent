import { describe, test, expect } from "vitest";
import { encode, parseLines, type ClientMessage, type ServerMessage, PROTOCOL_VERSION } from "../src/ipc/protocol.js";

describe("IPC protocol encode/parseLines", () => {
  test("encode produces newline-terminated JSON", () => {
    const msg: ClientMessage = { type: "ping" };
    const line = encode(msg);
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual(msg);
  });

  test("parseLines handles a single complete line", () => {
    const buffer = encode({ type: "pong" } as ServerMessage);
    const { messages, remaining } = parseLines<ServerMessage>(buffer);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "pong" });
    expect(remaining).toBe("");
  });

  test("parseLines preserves incomplete trailing fragment", () => {
    const partial = '{"type":"ping"}\n{"type":"po';
    const { messages, remaining } = parseLines<ClientMessage>(partial);
    expect(messages).toEqual([{ type: "ping" }]);
    expect(remaining).toBe('{"type":"po');
  });

  test("parseLines skips malformed lines without throwing", () => {
    const buf = 'bad json\n{"type":"ping"}\n';
    const { messages } = parseLines<ClientMessage>(buf);
    expect(messages).toEqual([{ type: "ping" }]);
  });

  test("parseLines handles multiple messages in one chunk", () => {
    const buf = encode({ type: "ping" } as ClientMessage) + encode({ type: "sessions" } as ClientMessage);
    const { messages } = parseLines<ClientMessage>(buf);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("ping");
    expect(messages[1].type).toBe("sessions");
  });

  test("PROTOCOL_VERSION is exported", () => {
    expect(typeof PROTOCOL_VERSION).toBe("number");
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
