import { ClaudeSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { probeClaudeCapabilities } from "./ClaudeProvider.ts";
// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";

import { buildClaudeCapabilitiesProbeQueryOptions } from "./ClaudeProvider.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.layer(NodeServices.layer)("Claude capability probe SDK boundary", (it) => {
  it.effect("falls back to the stored .claude.json account email when init omits it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-probe-email-" });
      const executablePath = path.join(tempDir, "fake-claude.mjs");
      const claudeHome = yield* fs.makeTempDirectory({ prefix: "t3-claude-home-" });
      yield* fs.writeFileString(
        path.join(claudeHome, ".claude.json"),
        '{"oauthAccount":{"emailAddress":"stored@example.com"}}',
      );

      yield* fs.writeFileString(
        executablePath,
        [
          "#!/usr/bin/env node",
          'import { createInterface } from "node:readline";',
          "const lines = createInterface({ input: process.stdin });",
          'lines.on("line", (line) => {',
          "  const message = JSON.parse(line);",
          '  if (message.type !== "control_request") return;',
          '  if (message.request?.subtype === "initialize") {',
          "    process.stdout.write(JSON.stringify({",
          '      type: "control_response",',
          '      response: { subtype: "success", request_id: message.request_id, response: {',
          "        commands: [],",
          "        agents: [],",
          '        output_style: "default",',
          "        available_output_styles: [],",
          "        models: [],",
          '        account: { tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" },',
          "      } },",
          '    }) + "\\n");',
          "  }",
          '  if (message.request?.subtype === "get_usage") {',
          "    process.stdout.write(JSON.stringify({",
          '      type: "control_response",',
          '      response: { subtype: "success", request_id: message.request_id, response: {',
          "        session: {},",
          "        rate_limits_available: false,",
          "        rate_limits: {},",
          "        behaviors: null,",
          "      } },",
          '    }) + "\\n");',
          "  }",
          "});",
          "setInterval(() => {}, 1_000);",
          "",
        ].join("\n"),
      );
      yield* fs.chmod(executablePath, 0o755);

      const capabilities = yield* probeClaudeCapabilities(
        decodeClaudeSettings({ binaryPath: executablePath, homePath: claudeHome }),
      );

      assert.equal(capabilities?.tokenSource, "CLAUDE_CODE_OAUTH_TOKEN");
      assert.equal(capabilities?.email, "stored@example.com");
    }).pipe(Effect.scoped),
  );
});
