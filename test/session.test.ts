import { describe, test, expect } from "vitest";
import { SessionManager } from "../src/session.js";

describe("SessionManager", () => {
  test("create and get session", () => {
    const mgr = new SessionManager();
    const s = mgr.create("user", "user");
    expect(s.name).toBe("user");
    expect(s.type).toBe("user");
    expect(s.messages).toEqual([]);
    expect(mgr.get(s.id)).toBe(s);
  });

  test("create with explicit id", () => {
    const mgr = new SessionManager();
    const s = mgr.create("test", "user", "my-fixed-id");
    expect(s.id).toBe("my-fixed-id");
    expect(mgr.get("my-fixed-id")).toBe(s);
  });

  test("first session becomes active", () => {
    const mgr = new SessionManager();
    const s = mgr.create("first", "user");
    expect(mgr.active).toBe(s);
    expect(mgr.activeId).toBe(s.id);
  });

  test("second session does not override active", () => {
    const mgr = new SessionManager();
    const s1 = mgr.create("first", "user");
    mgr.create("second", "system");
    expect(mgr.active).toBe(s1);
  });

  test("setActive changes active session", () => {
    const mgr = new SessionManager();
    mgr.create("first", "user");
    const s2 = mgr.create("second", "user");
    mgr.setActive(s2.id);
    expect(mgr.active).toBe(s2);
  });

  test("setActive throws for unknown id", () => {
    const mgr = new SessionManager();
    expect(() => mgr.setActive("nope")).toThrow("Session not found");
  });

  test("getByName returns matching session", () => {
    const mgr = new SessionManager();
    mgr.create("user", "user");
    const sys = mgr.create("system", "system");
    expect(mgr.getByName("system")).toBe(sys);
    expect(mgr.getByName("missing")).toBeUndefined();
  });

  test("list with type filter", () => {
    const mgr = new SessionManager();
    mgr.create("u1", "user");
    mgr.create("u2", "user");
    mgr.create("sys", "system");
    expect(mgr.list("user")).toHaveLength(2);
    expect(mgr.list("system")).toHaveLength(1);
    expect(mgr.list()).toHaveLength(3);
  });

  test("delete removes session", () => {
    const mgr = new SessionManager();
    const s = mgr.create("temp", "user");
    mgr.delete(s.id);
    expect(mgr.has(s.id)).toBe(false);
  });

  test("delete active session clears active", () => {
    const mgr = new SessionManager();
    const s = mgr.create("only", "user");
    mgr.delete(s.id);
    expect(() => mgr.active).toThrow("No active session");
  });

  test("touch updates lastActiveAt", () => {
    const mgr = new SessionManager();
    const s = mgr.create("test", "user");
    const before = s.lastActiveAt;
    mgr.touch(s.id);
    expect(s.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  test("has returns correct boolean", () => {
    const mgr = new SessionManager();
    const s = mgr.create("test", "user");
    expect(mgr.has(s.id)).toBe(true);
    expect(mgr.has("nonexistent")).toBe(false);
  });
});
