import type { KnownComposerContextRecord } from "./composerContext.ts";

/** Fork: context kinds upstream does not have, such as linked Linear issues and Slack threads. */
export const INTEGRATION_CONTEXT_KINDS = [
  "thread-tab",
  "linear-issue",
  "linear-object",
  "github-issue",
  "repository",
  "checkout",
  "slack-thread",
  "discord-thread",
  "notion-page",
  "google-file",
  "granola-note",
  "subagent",
  "prompt-link",
  "github-ref",
  "unread-link",
  "model",
] as const;
export type IntegrationContextKind = (typeof INTEGRATION_CONTEXT_KINDS)[number];

export type IntegrationContextRecord = Extract<
  KnownComposerContextRecord,
  { kind: IntegrationContextKind }
>;
