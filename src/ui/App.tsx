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
  const { messages, isLoading, sendMessage, agent } = useChat();
  const [scrollMode, setScrollMode] = useState(false);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape) {
      setScrollMode((prev) => !prev);
    }
    if (input === "d" && key.ctrl) {
      agent?.close().then(() => exit());
    }
  });

  const handleSubmit = useCallback(
    (text: string) => {
      if (["q", "quit", "exit"].includes(text.toLowerCase())) {
        agent?.close().then(() => exit());
        return;
      }
      sendMessage(text);
      setScrollMode(false);
    },
    [sendMessage, agent, exit],
  );

  const exchangeList = agent?.exchangeManager?.list() ?? [config.defaultExchange];
  const soulName = agent?.soul?.name ?? config.tradingSoul;

  const activePalette = palette?.show ? { items: palette.items, idx: palette.idx } : null;

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        paperTrading={config.paperTrading}
        exchange={exchangeList.join(", ")}
        exchangeCount={exchangeList.length}
        soul={soulName}
        llmProvider={config.llmProvider}
        modelId={config.modelId}
        contextWindow={config.llmContextWindow}
      />
      <Divider />
      <ChatView messages={messages} isLoading={isLoading} scrollMode={scrollMode} palette={activePalette} />
      <Divider />
      <InputBar onSubmit={handleSubmit} isLoading={isLoading} isFocused={!scrollMode} onPaletteChange={setPalette} />
      <Divider />
      <HelpBar scrollMode={scrollMode} />
    </Box>
  );
}
