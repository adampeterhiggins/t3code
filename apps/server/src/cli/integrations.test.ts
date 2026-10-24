import { assert, it } from "@effect/vitest";

import {
  fromGranola,
  fromLinear,
  integrationEnabled,
  loginProgress,
  readPastedCallback,
  statusLine,
  type IntegrationState,
} from "./integrations.ts";

const linearWaiting = fromLinear({
  phase: "waiting",
  account: null,
  flowId: "flow-1",
  authorizationUrl: "https://linear.app/oauth/authorize?state=x",
  expiresAt: null,
  message: null,
});

it("a sign-in waits only on its own flow", () => {
  assert.deepStrictEqual(loginProgress(linearWaiting, "flow-1"), { _tag: "Waiting" });
  assert.deepStrictEqual(loginProgress(linearWaiting, "flow-0"), {
    _tag: "Failed",
    message: "Another Linear sign-in replaced this one.",
  });
});

it("a sign-in ends connected, failed with the server's reason, or cancelled", () => {
  const connected = fromLinear({
    phase: "connected",
    account: {
      name: "Ada",
      email: "ada@example.com",
      workspaceName: "Acme",
      workspaceUrlKey: "acme",
    },
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  });
  assert.deepStrictEqual(loginProgress(connected, "flow-1"), {
    _tag: "Connected",
    account: "Ada (ada@example.com) in Acme",
  });
  assert.deepStrictEqual(
    loginProgress(
      { ...linearWaiting, phase: "failed", message: "Linear sign-in timed out." },
      "flow-1",
    ),
    { _tag: "Failed", message: "Linear sign-in timed out." },
  );
  assert.deepStrictEqual(loginProgress({ ...linearWaiting, phase: "disconnected" }, "flow-1"), {
    _tag: "Failed",
    message: "Linear sign-in was cancelled.",
  });
});

it("Granola's device flow carries its code and verification page", () => {
  const state = fromGranola({
    phase: "waiting",
    account: null,
    flowId: "flow-2",
    verificationUrl: "https://granola.ai/device",
    userCode: "ABCD-EFGH",
    expiresAt: null,
    message: null,
  });
  assert.strictEqual(state.url, "https://granola.ai/device");
  assert.strictEqual(state.userCode, "ABCD-EFGH");
});

it("status shows the account when connected and the reason when failed", () => {
  const connected: IntegrationState = {
    ...linearWaiting,
    name: "slack",
    phase: "connected",
    account: "ada in Acme",
  };
  assert.strictEqual(statusLine(connected, true), "slack    connected    ada in Acme");
  assert.strictEqual(
    statusLine({ ...connected, phase: "failed", message: "Token revoked." }, true),
    "slack    failed       Token revoked.",
  );
  assert.strictEqual(
    statusLine({ ...connected, phase: "disconnected" }, false),
    "slack    disconnected (turned off in settings)",
  );
});

it("Linear is always on; the others follow their settings toggle", () => {
  const settings = {
    enableSlackIntegration: false,
    enableDiscordIntegration: true,
    enableNotionIntegration: false,
    enableGoogleIntegration: false,
    enableGranolaIntegration: true,
  };
  assert.isTrue(integrationEnabled("linear", settings));
  assert.isFalse(integrationEnabled("slack", settings));
  assert.isFalse(integrationEnabled("notion", settings));
  assert.isTrue(integrationEnabled("granola", settings));
});

it("a pasted callback URL loses wrapping quotes and brackets, and blank lines are skipped", () => {
  const url = "http://localhost:47831/callback?code=abc&state=xyz";
  assert.strictEqual(readPastedCallback(`  ${url}  `), url);
  assert.strictEqual(readPastedCallback(`"${url}"`), url);
  assert.strictEqual(readPastedCallback(`'${url}'`), url);
  assert.strictEqual(readPastedCallback(`<${url}>`), url);
  assert.strictEqual(readPastedCallback(`"${url}'`), `"${url}'`);
  assert.isNull(readPastedCallback("   "));
  assert.isNull(readPastedCallback('""'));
});
