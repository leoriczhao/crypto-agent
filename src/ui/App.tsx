import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { StatusBar } from "./StatusBar.js";
import { ChatView } from "./ChatView.js";
import { InputBar, type PaletteState } from "./InputBar.js";
import { HelpBar } from "./HelpBar.js";
import { useChat } from "./useChat.js";
import { config } from "../config.js";

function Divider() {
  const { stdout } = useStdout();
  const w = stdout?.columns ?? 80;
  return <Text dimColor>{"─".repeat(w)}</Text>;
}

export function App() {
  const { messages, isLoading, sendMessage, connected, info, activeSession, cancel, shutdown } = useChat();
  const [scrollMode, setScrollMode] = useState(false);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "c" && key.ctrl && isLoading) {
      cancel();
      return;
    }
    if (key.escape) {
      setScrollMode((prev) => !prev);
    }
    if (input === "d" && key.ctrl) {
      shutdown();
      exit();
    }
  });

  const handleSubmit = useCallback(
    (text: string) => {
      if (["q", "quit", "exit"].includes(text.toLowerCase())) {
        shutdown();
        exit();
        return;
      }
      sendMessage(text);
      setScrollMode(false);
    },
    [sendMessage, shutdown, exit],
  );

  // While waiting for the daemon welcome we fall back to env-derived config
  // so the status bar is never empty on first render.
  const exchangeLabel = info?.exchange ?? config.defaultExchange;
  const soulName = info?.soul ?? config.tradingSoul;
  const mode = info?.mode ?? (config.paperTrading ? "PAPER" : "LIVE");

  const activePalette = palette?.show ? { items: palette.items, idx: palette.idx } : null;

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        paperTrading={mode === "PAPER"}
        exchange={exchangeLabel}
        exchangeCount={1}
        soul={soulName}
        llmProvider={config.llmProvider}
        modelId={config.modelId}
        contextWindow={config.llmContextWindow}
        connected={connected}
        session={activeSession}
        daemonPid={info?.daemonPid ?? 0}
      />
      <Divider />
      <ChatView messages={messages} isLoading={isLoading} scrollMode={scrollMode} palette={activePalette} />
      <Divider />
      <InputBar onSubmit={handleSubmit} isLoading={isLoading} isFocused={!scrollMode} onPaletteChange={setPalette} />
      <Divider />
      <HelpBar scrollMode={scrollMode} isLoading={isLoading} />
    </Box>
  );
}
