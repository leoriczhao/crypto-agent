import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  paperTrading: boolean;
  exchange: string;
  exchangeCount: number;
  soul: string;
  llmProvider: string;
  modelId: string;
  contextWindow: number;
  connected: boolean;
  session: string;
  daemonPid: number;
}

export function StatusBar({
  paperTrading,
  exchange,
  exchangeCount,
  soul,
  llmProvider,
  modelId,
  contextWindow,
  connected,
  session,
  daemonPid,
}: StatusBarProps) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text backgroundColor={paperTrading ? "green" : "red"} color="white" bold>
        {" "}
        {paperTrading ? "PAPER" : "LIVE"}
        {" "}
      </Text>
      <Text color="cyan">
        {exchange}
        {exchangeCount > 1 ? ` (${exchangeCount})` : ""}
      </Text>
      <Text color="yellow">{soul}</Text>
      <Text color={connected ? "green" : "red"}>
        {connected ? `⬢ daemon:${daemonPid}` : "⬡ disconnected"}
      </Text>
      <Text color="magenta">@{session}</Text>
      <Text dimColor>
        {llmProvider} · {modelId} · ctx={contextWindow.toLocaleString()}
      </Text>
    </Box>
  );
}
