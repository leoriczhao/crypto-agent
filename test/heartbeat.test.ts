import { describe, test, expect, vi } from "vitest";
import { HeartbeatScheduler } from "../src/heartbeat.js";

describe("HeartbeatScheduler", () => {
  test("calls agent.chatInSession with sessionId on tick", async () => {
    const agent = { chatInSession: vi.fn().mockResolvedValue("All clear.") };
    const hb = new HeartbeatScheduler(agent, 1, "sys-session-id");
    await hb.start();
    await new Promise((r) => setTimeout(r, 1500));
    await hb.stop();
    expect(agent.chatInSession).toHaveBeenCalled();
    expect(agent.chatInSession.mock.calls[0][0]).toBe("sys-session-id");
  });
});
