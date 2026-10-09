// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CustomAcpSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { execScriptSource, writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import { checkCustomAcpProviderStatus } from "./CustomAcpProvider.ts";

const decodeSettings = Schema.decodeSync(CustomAcpSettings);
const mockAgentPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../scripts/acp-mock-agent.ts",
);

const makeMockAgent = Effect.promise(async () => {
  const workspace = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "custom-acp-probe-"));
  const binaryPath = writeFakeCli({
    directory: NodePath.join(workspace, "bin"),
    name: "fake-agent",
    source: execScriptSource({ scriptPath: mockAgentPath }),
  });
  return { workspace, binaryPath };
});

it.layer(NodeServices.layer)("checkCustomAcpProviderStatus", (it) => {
  it.effect("reports the models and modes the agent advertises", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const snapshot = yield* checkCustomAcpProviderStatus(
        decodeSettings({ binaryPath: agent.binaryPath }),
        process.env,
        agent.workspace,
      );

      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.showInteractionModeToggle, true);
      assert.isAbove(snapshot.models.length, 1);
      assert.include(
        snapshot.models.map((model) => model.slug),
        "composer-2",
      );
      assert.equal(snapshot.models.filter((model) => model.isDefault).length, 1);
    }),
  );

  it.effect("explains a missing or unset executable", () =>
    Effect.gen(function* () {
      const missing = yield* checkCustomAcpProviderStatus(
        decodeSettings({ binaryPath: "t3-no-such-acp-agent" }),
        process.env,
        process.cwd(),
      );
      assert.equal(missing.status, "error");
      assert.equal(missing.installed, false);

      const unset = yield* checkCustomAcpProviderStatus(
        decodeSettings({}),
        process.env,
        process.cwd(),
      );
      assert.equal(unset.status, "error");
      assert.equal(unset.message, "Set the agent executable in Settings → Providers.");
    }),
  );
});
