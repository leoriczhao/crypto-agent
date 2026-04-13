import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { MessageBubble, type ChatMessage } from "./MessageBubble.js";
import { renderMd } from "./markdown.js";
import Spinner from "ink-spinner";

export interface PaletteItem {
  cmd: string;
  arg: string;
  desc: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  isLoading: boolean;
  scrollMode: boolean;
  palette?: { items: PaletteItem[]; idx: number } | null;
}

export function ChatView({ messages, isLoading, scrollMode, palette }: ChatViewProps) {
  const { stdout } = useStdout();
  const totalHeight = Math.max(6, (stdout?.rows ?? 24) - 6);
  const paletteRows = palette ? palette.items.length + 1 : 0;
  const chatHeight = totalHeight - paletteRows;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);

  const allLines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      allLines.push("");
      allLines.push("\x1b[1m\x1b[32mYou:\x1b[0m");
      allLines.push(msg.content);
    } else if (msg.role === "assistant") {
      allLines.push("");
      allLines.push("\x1b[1m\x1b[34mAssistant:\x1b[0m");
      const rendered = renderMd(msg.content);
      allLines.push(...rendered.split("\n"));
    } else {
      allLines.push("\x1b[2m" + msg.content + "\x1b[0m");
    }
  }
  if (isLoading) {
    allLines.push("");
  }

  const maxScroll = Math.max(0, allLines.length - chatHeight);

  useEffect(() => {
    if (!userScrolled) {
      setScrollOffset(maxScroll);
    }
  }, [allLines.length, maxScroll, userScrolled]);

  useInput(
    (input, key) => {
      if (!scrollMode) return;
      if (key.upArrow || input === "k") {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        setUserScrolled(true);
      }
      if (key.downArrow || input === "j") {
        setScrollOffset((prev) => {
          const next = Math.min(maxScroll, prev + 1);
          if (next >= maxScroll) setUserScrolled(false);
          return next;
        });
      }
      if (input === "G") {
        setScrollOffset(maxScroll);
        setUserScrolled(false);
      }
      if (key.pageUp) {
        setScrollOffset((prev) => Math.max(0, prev - Math.floor(chatHeight / 2)));
        setUserScrolled(true);
      }
      if (key.pageDown) {
        setScrollOffset((prev) => {
          const next = Math.min(maxScroll, prev + Math.floor(chatHeight / 2));
          if (next >= maxScroll) setUserScrolled(false);
          return next;
        });
      }
    },
    { isActive: scrollMode },
  );

  const visibleLines = allLines.slice(scrollOffset, scrollOffset + chatHeight);
  while (visibleLines.length < chatHeight) {
    visibleLines.push(" ");
  }

  const atBottom = scrollOffset >= maxScroll;

  return (
    <Box flexDirection="column" height={totalHeight} flexGrow={1}>
      {visibleLines.map((line, i) => (
        <Text key={`${scrollOffset}-${i}`} wrap="truncate">
          {line || " "}
        </Text>
      ))}
      {isLoading && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Thinking...</Text>
        </Box>
      )}
      {!atBottom && scrollMode && (
        <Box justifyContent="flex-end">
          <Text dimColor inverse> ↓ More below (G = bottom) </Text>
        </Box>
      )}
      {palette && palette.items.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {palette.items.map((c, i) => (
            <Box key={c.cmd}>
              <Text color={i === palette.idx ? "cyan" : "gray"} bold={i === palette.idx}>
                {i === palette.idx ? "▸ " : "  "}
              </Text>
              <Text color={i === palette.idx ? "cyan" : "white"} bold={i === palette.idx}>
                {c.cmd}
              </Text>
              {c.arg ? <Text color="gray"> {c.arg}</Text> : null}
              <Text dimColor>  {c.desc}</Text>
            </Box>
          ))}
          <Text dimColor>  ↑↓ select · Tab fill · Enter confirm</Text>
        </Box>
      )}
    </Box>
  );
}
