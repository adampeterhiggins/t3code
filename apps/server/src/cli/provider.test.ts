import { assert, it } from "@effect/vitest";
import { ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { formatProviderTable } from "./provider.ts";

const decodeProvider = Schema.decodeSync(ServerProvider);
const provider = (fields: Record<string, unknown>) =>
  decodeProvider({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1.2.3",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-21T00:00:00.000Z",
    models: [],
    ...fields,
  });

it("shows disabled instances as disabled and names the signed-in account", () => {
  const lines = formatProviderTable([
    provider({ auth: { status: "authenticated", email: "a@example.com" } }),
    provider({
      instanceId: "claude-work",
      driver: "claudeAgent",
      enabled: false,
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
    }),
  ]);
  assert.deepStrictEqual(lines, [
    "INSTANCE     DRIVER       STATUS    AUTH                           VERSION        MESSAGE",
    "codex        codex        ready     authenticated (a@example.com)  1.2.3",
    "claude-work  claudeAgent  disabled  unknown                        not installed",
  ]);
});
