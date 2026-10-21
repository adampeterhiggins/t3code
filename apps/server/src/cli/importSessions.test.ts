import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId, type AgentSessionSummary } from "@t3tools/contracts";

import { formatImportRow, importRows } from "./importSessions.ts";
import { matchId } from "./liveRpc.ts";

const session = (overrides: Partial<AgentSessionSummary>): AgentSessionSummary => ({
  providerInstanceId: ProviderInstanceId.make("claude"),
  providerSessionId: "0b5e2c4a-1111-4a5b-9c1d-2e3f4a5b6c7d",
  provider: "claudeAgent",
  title: "Fix the login flow",
  preview: "Fix the login flow",
  messageCount: 4,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  threadId: null,
  ...overrides,
});

const rows = importRows(
  [
    session({}),
    session({
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerSessionId: "7f00aa11-2222-4c3d-8e9f-0a1b2c3d4e5f",
      provider: "codex",
      title: "Add dark mode",
      updatedAt: "2026-10-03T10:00:00.000Z",
      threadId: ThreadId.make("import:codex:7f00aa11"),
    }),
  ],
  [
    {
      workspaceId: "ws-yaounde",
      title: "Billing page",
      name: "yaounde",
      branch: "adam/billing",
      path: "/Users/adam/conductor/yaounde",
      updatedAt: "2026-10-02T10:00:00.000Z",
      tabs: [],
      threadId: null,
    },
  ],
);

it("lists conversations from every source newest first, marking ones already imported", () => {
  assert.deepStrictEqual(
    rows.map((row) => [row.source, row.id]),
    [
      ["codex", "7f00aa11-2222-4c3d-8e9f-0a1b2c3d4e5f"],
      ["conductor", "ws-yaounde"],
      ["claude", "0b5e2c4a-1111-4a5b-9c1d-2e3f4a5b6c7d"],
    ],
  );
  assert.match(
    formatImportRow(rows[0]!),
    /^7f00aa11-2222-4c3d-8e9f-0a1b2c3d4e5f {2}codex {6}2026-10-03 \d\d:00 {2}Add dark mode {2}-> import:codex:7f00aa11$/,
  );
  assert.include(formatImportRow(rows[1]!), "Billing page [adam/billing]");
});

it("finds a conversation by a pasted fragment of its id, and refuses an ambiguous one", () => {
  const byPrefix = matchId(rows, (row) => row.id, "0B5E2C4A");
  assert.strictEqual(byPrefix.type === "found" ? byPrefix.item.source : null, "claude");
  const ambiguous = matchId(rows, (row) => row.id, "-4");
  assert.strictEqual(ambiguous.type, "ambiguous");
  assert.strictEqual(matchId(rows, (row) => row.id, "nope").type, "none");
});
