import type { OrchestrationMessage } from "@t3tools/contracts";

const MAX_MESSAGE_CHARS = 1_500;
const MAX_SUMMARY_CHARS = 8_000;

/** A bounded, extractive handoff: the source chat remains the authority. */
export function summarizeSiblingMessages(
  title: string,
  messages: ReadonlyArray<OrchestrationMessage>,
): string {
  const dialogue = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      !message.streaming &&
      message.text.trim().length > 0,
  );
  const selected = [dialogue[0], ...dialogue.slice(-8)].filter(
    (message, index, all) =>
      message && all.findIndex((entry) => entry?.id === message.id) === index,
  );
  const lines = selected.map(
    (message) =>
      `${message!.role === "user" ? "User" : "Assistant"}: ${message!.text.trim().slice(0, MAX_MESSAGE_CHARS)}`,
  );
  return `Related chat: ${title}\n${lines.join("\n\n")}`.slice(0, MAX_SUMMARY_CHARS);
}
