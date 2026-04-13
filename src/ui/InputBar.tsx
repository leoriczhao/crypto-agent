import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Constants ───────────────────────────────────────────────────────────────

const HISTORY_FILE = join(homedir(), ".crypto_agent_history");

export const SLASH_COMMANDS = [
  { cmd: "/new", arg: "[name]", desc: "Create new session" },
  { cmd: "/sessions", arg: "", desc: "List all sessions" },
  { cmd: "/switch", arg: "<name>", desc: "Switch session" },
  { cmd: "/current", arg: "", desc: "Current session info" },
  { cmd: "/compact", arg: "", desc: "Compact context" },
  { cmd: "/trades", arg: "[n]", desc: "Recent trades" },
  { cmd: "/delete", arg: "<name>", desc: "Delete session" },
  { cmd: "/help", arg: "", desc: "Show all commands" },
];

function loadHistory(): string[] {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
}

function saveHistory(line: string): void {
  appendFileSync(HISTORY_FILE, line + "\n");
}

// ── Hooks ───────────────────────────────────────────────────────────────────

function useHistory() {
  const [list, setList] = useState<string[]>(() => loadHistory());
  const [idx, setIdx] = useState(-1);

  const add = (line: string) => {
    saveHistory(line);
    setList((prev) => [...prev, line]);
    setIdx(-1);
  };
  const prev = (): string | null => {
    if (!list.length) return null;
    const i = Math.min(idx + 1, list.length - 1);
    setIdx(i);
    return list[list.length - 1 - i] ?? null;
  };
  const next = (): string | null => {
    const i = Math.max(idx - 1, -1);
    setIdx(i);
    return i === -1 ? "" : (list[list.length - 1 - i] ?? "");
  };
  const reset = () => setIdx(-1);

  return { add, prev, next, reset };
}

function usePalette(text: string, active: boolean) {
  const [idx, setIdx] = useState(0);

  const token = text.split(/\s/)[0] ?? "";
  const open = active && text.startsWith("/") && !text.includes(" ");
  const items = open ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(token)) : [];
  const show = open && items.length > 0;

  useEffect(() => setIdx(0), [token]);

  const up = () => setIdx((p) => (p <= 0 ? items.length - 1 : p - 1));
  const down = () => setIdx((p) => (p >= items.length - 1 ? 0 : p + 1));

  return { show, items, idx, up, down, selected: items[idx] };
}

// ── Component ───────────────────────────────────────────────────────────────

export interface PaletteState {
  show: boolean;
  items: typeof SLASH_COMMANDS;
  idx: number;
  selected: (typeof SLASH_COMMANDS)[number] | undefined;
}

interface InputBarProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
  isFocused: boolean;
  onPaletteChange?: (state: PaletteState) => void;
}

export function InputBar({ onSubmit, isLoading, isFocused, onPaletteChange }: InputBarProps) {
  const [buf, setBuf] = useState({ text: "", cur: 0 });
  const hist = useHistory();
  const canType = isFocused;
  const palette = usePalette(buf.text, canType && !isLoading);

  useEffect(() => {
    onPaletteChange?.(palette);
  }, [palette.show, palette.items.length, palette.idx, onPaletteChange]);

  const set = (text: string, cur?: number) => setBuf({ text, cur: cur ?? text.length });

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || isLoading) return;
    hist.add(t);
    onSubmit(t);
    setBuf({ text: "", cur: 0 });
  };

  useInput(
    (input, key) => {
      // ── Enter ──
      if (key.return) {
        if (palette.show && palette.selected) {
          const sel = palette.selected;
          sel.arg ? set(sel.cmd + " ") : submit(sel.cmd);
        } else {
          submit(buf.text);
        }
        return;
      }

      // ── Tab (palette fill) ──
      if (key.tab && palette.show && palette.selected) {
        const sel = palette.selected;
        set(sel.arg ? sel.cmd + " " : sel.cmd);
        return;
      }

      // ── Up / Down ──
      if (key.upArrow) {
        if (palette.show) { palette.up(); }
        else { const v = hist.prev(); if (v !== null) set(v); }
        return;
      }
      if (key.downArrow) {
        if (palette.show) { palette.down(); }
        else { const v = hist.next(); if (v !== null) set(v); }
        return;
      }

      // ── Cursor movement ──
      if (key.leftArrow) { setBuf((b) => ({ ...b, cur: Math.max(0, b.cur - 1) })); return; }
      if (key.rightArrow) { setBuf((b) => ({ ...b, cur: Math.min(b.text.length, b.cur + 1) })); return; }

      // ── Escape ──
      if (key.escape) { setBuf({ text: "", cur: 0 }); return; }

      // ── Backspace / Delete ──
      // ink 6 maps \x7f (the byte most terminals send for Backspace) to
      // key.delete instead of key.backspace.  Treat both as backward-delete,
      // matching what ink-text-input does.
      if (key.backspace || key.delete) {
        setBuf((b) => b.cur > 0
          ? { text: b.text.slice(0, b.cur - 1) + b.text.slice(b.cur), cur: b.cur - 1 }
          : b,
        );
        hist.reset();
        return;
      }

      // ── Ctrl shortcuts ──
      if (key.ctrl) {
        if (input === "a") { setBuf((b) => ({ ...b, cur: 0 })); }
        if (input === "e") { setBuf((b) => ({ ...b, cur: b.text.length })); }
        if (input === "u") { setBuf({ text: "", cur: 0 }); }
        if (input === "k") { setBuf((b) => ({ text: b.text.slice(0, b.cur), cur: b.cur })); }
        return;
      }

      // ── Character input ──
      if (input && !key.meta && !key.tab) {
        setBuf((b) => ({
          text: b.text.slice(0, b.cur) + input + b.text.slice(b.cur),
          cur: b.cur + input.length,
        }));
        hist.reset();
      }
    },
    { isActive: canType },
  );

  // ── Render (single-line with horizontal scroll) ──

  const { stdout: out } = useStdout();
  const cols = out?.columns ?? 80;
  const prompt = ">> ";
  const maxVis = cols - prompt.length - 1;
  const { text, cur } = buf;

  let visBefore: string;
  let visCursor: string;
  let visAfter: string;

  if (text.length <= maxVis) {
    visBefore = text.slice(0, cur);
    visCursor = text[cur] ?? " ";
    visAfter = text.slice(cur + 1);
  } else {
    let start = Math.max(0, cur - Math.floor(maxVis * 0.7));
    if (start + maxVis > text.length) start = Math.max(0, text.length - maxVis);
    const vc = cur - start;
    const window = text.slice(start, start + maxVis);
    visBefore = window.slice(0, vc);
    visCursor = window[vc] ?? " ";
    visAfter = window.slice(vc + 1);
  }

  return (
    <Box>
      <Text color="green" bold>{prompt}</Text>
      {canType ? (
        <Text wrap="truncate">
          {visBefore}
          <Text inverse>{visCursor}</Text>
          {visAfter}
          {!text && <Text dimColor> {isLoading ? "waiting for response..." : "Type a message... (/ for commands)"}</Text>}
        </Text>
      ) : (
        <Text wrap="truncate" dimColor>Type a message...</Text>
      )}
    </Box>
  );
}
