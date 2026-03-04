import type { ContentBlock, ConversationMessage } from "./storage";

export interface ConversationMetrics {
  turnUnits: number;
  exchangeCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  userCharacters: number;
  assistantCharacters: number;
  totalCharacters: number;
  userPercent: number;
  assistantPercent: number;
  ratioLabel: string;
  toolEventCount: number;
}

function extractVisibleText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function countToolEvents(content: string | ContentBlock[]): number {
  if (typeof content === "string") {
    return 0;
  }

  return content.filter(
    (block) => block.type === "tool_use" || block.type === "tool_result",
  ).length;
}

function toPercent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

function toRatioLabel(
  userCharacters: number,
  assistantCharacters: number,
): string {
  if (userCharacters <= 0 && assistantCharacters <= 0) {
    return "1:1";
  }

  if (assistantCharacters <= 0) {
    return "1:0";
  }

  if (userCharacters <= 0) {
    return "0:1";
  }

  if (userCharacters >= assistantCharacters) {
    const ratio = userCharacters / assistantCharacters;
    return `${ratio.toFixed(2)}:1`;
  }

  const ratio = assistantCharacters / userCharacters;
  return `1:${ratio.toFixed(2)}`;
}

export function calculateConversationMetrics(
  messages: ConversationMessage[],
): ConversationMetrics {
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let userCharacters = 0;
  let assistantCharacters = 0;
  let toolEventCount = 0;

  for (const message of messages) {
    if (message.type !== "user" && message.type !== "assistant") {
      continue;
    }

    const content = message.message?.content;
    const visibleText = content ? extractVisibleText(content) : "";
    const characterCount = visibleText.length;

    if (message.type === "user") {
      userMessageCount += 1;
      userCharacters += characterCount;
    } else {
      assistantMessageCount += 1;
      assistantCharacters += characterCount;
    }

    if (content) {
      toolEventCount += countToolEvents(content);
    }
  }

  const turnUnits = userMessageCount + assistantMessageCount;
  const totalCharacters = userCharacters + assistantCharacters;
  const userPercent = toPercent(userCharacters, totalCharacters);
  const assistantPercent = toPercent(assistantCharacters, totalCharacters);

  return {
    turnUnits,
    exchangeCount: Math.min(userMessageCount, assistantMessageCount),
    userMessageCount,
    assistantMessageCount,
    userCharacters,
    assistantCharacters,
    totalCharacters,
    userPercent,
    assistantPercent,
    ratioLabel: toRatioLabel(userCharacters, assistantCharacters),
    toolEventCount,
  };
}
