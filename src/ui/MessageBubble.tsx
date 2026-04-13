import React from "react";
import { Box, Text } from "ink";
import { renderMd } from "./markdown.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="green" bold>You:</Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "assistant") {
    const rendered = renderMd(message.content);
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="blue" bold>Assistant:</Text>
        <Text>{rendered}</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}
