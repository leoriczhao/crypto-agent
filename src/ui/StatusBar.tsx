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
}

export function StatusBar({ paperTrading, exchange, exchangeCount, soul, llmProvider, modelId, contextWindow }: StatusBarProps) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text backgroundColor={paperTrading ? "green" : "red"} color="white" bold> {paperTrading ? "PAPER" : "LIVE"} </Text>
      <Text color="cyan">{exchange}{exchangeCount > 1 ? ` (${exchangeCount})` : ""}</Text>
      <Text color="yellow">{soul}</Text>
      <Text dimColor>{llmProvider} · {modelId} · ctx={contextWindow.toLocaleString()}</Text>
    </Box>
  );
}
