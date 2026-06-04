import React from "react";
import { Box, Text } from "ink";

interface HelpBarProps {
  scrollMode: boolean;
  isLoading: boolean;
}

export function HelpBar({ scrollMode, isLoading }: HelpBarProps) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>Ctrl+D</Text><Text dimColor>quit</Text>
      <Text dimColor>·</Text>
      <Text dimColor>Ctrl+C</Text><Text dimColor>{isLoading ? "cancel" : "idle"}</Text>
      <Text dimColor>·</Text>
      <Text dimColor>Esc</Text><Text dimColor>{scrollMode ? "back to input" : "scroll mode"}</Text>
      <Text dimColor>·</Text>
      <Text dimColor>↑↓</Text><Text dimColor>{scrollMode ? "scroll" : "history"}</Text>
    </Box>
  );
}
