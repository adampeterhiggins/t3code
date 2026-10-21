import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  buildProjectOverridePatch,
  buildResetPatch,
  buildSettingsPatch,
  flattenSettings,
  parseSettingValue,
  splitKeyPath,
} from "./settings.ts";

const decodePatch = Schema.decodeEffect(ServerSettingsPatch);
const settings = {
  ...Schema.encodeSync(ServerSettings)(DEFAULT_SERVER_SETTINGS),
  sourceControlHosts: { "github.com": { token: "••••••", user: "adam" } },
  projectSettingsOverrides: {
    "project-1": { branchNamePrefix: "adam/", providerInstances: {} },
  },
};

it("reads values as JSON when they parse and as text otherwise", () => {
  assert.strictEqual(parseSettingValue("true"), true);
  assert.strictEqual(parseSettingValue("30"), 30);
  assert.strictEqual(parseSettingValue("null"), null);
  assert.deepStrictEqual(parseSettingValue('{"mode":"off"}'), { mode: "off" });
  assert.strictEqual(parseSettingValue("adam/"), "adam/");
});

it("keeps dotted map keys together when they exist", () => {
  assert.deepStrictEqual(splitKeyPath(settings, "sourceControlHosts.github.com.user"), [
    "sourceControlHosts",
    "github.com",
    "user",
  ]);
  assert.deepStrictEqual(splitKeyPath(settings, "storageCleanup.logsAfterDays"), [
    "storageCleanup",
    "logsAfterDays",
  ]);
});

it.effect("a nested set sends the whole top-level value with siblings kept", () =>
  Effect.gen(function* () {
    const patch = yield* buildSettingsPatch(settings, "storageCleanup.logsAfterDays", 7);
    assert.deepStrictEqual(patch, {
      storageCleanup: { ...settings.storageCleanup, logsAfterDays: 7 },
    });
    // The encoded settings value must still satisfy the patch schema the server checks.
    yield* decodePatch(patch);

    const secretPatch = yield* buildSettingsPatch(
      settings,
      "sourceControlHosts.github.com.user",
      "other",
    );
    assert.deepStrictEqual(secretPatch, {
      sourceControlHosts: { "github.com": { token: "••••••", user: "other" } },
    });
  }),
);

it.effect("refuses keys the server would silently ignore", () =>
  Effect.gen(function* () {
    const unknown = yield* Effect.flip(buildSettingsPatch(settings, "notASetting", true));
    assert.include(unknown.message, "'notASetting'");
    const serverOwned = yield* Effect.flip(
      buildSettingsPatch(settings, "previousWorktreesDirectories", []),
    );
    assert.include(serverOwned.message, "previousWorktreesDirectories");
  }),
);

it.effect("unset writes the default value and refuses paths without one", () =>
  Effect.gen(function* () {
    const changed = { ...settings, stopAtSubscriptionLimit: true };
    assert.deepStrictEqual(yield* buildResetPatch(changed, "stopAtSubscriptionLimit"), {
      stopAtSubscriptionLimit: false,
    });
    const noDefault = yield* Effect.flip(buildResetPatch(settings, "providerAuthMethods.codex"));
    assert.include(noDefault.message, "has no default");
  }),
);

it.effect("project overrides replace the entry and drop it once empty", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* buildProjectOverridePatch(settings, "project-1", "defaultAutoPull", { set: true }),
      {
        projectSettingsOverrides: {
          "project-1": { branchNamePrefix: "adam/", providerInstances: {}, defaultAutoPull: true },
        },
      },
    );
    assert.deepStrictEqual(
      yield* buildProjectOverridePatch(settings, "project-1", "branchNamePrefix", "unset"),
      { projectSettingsOverrides: { "project-1": null } },
    );
    const global = yield* Effect.flip(
      buildProjectOverridePatch(settings, "project-1", "enableSlackIntegration", { set: false }),
    );
    assert.include(global.message, "cannot be overridden per project");
  }),
);

it("flattens to paths that set accepts", () => {
  assert.deepStrictEqual(
    flattenSettings({ worktreeCleanup: { mode: "off" }, threadGroups: {}, tags: ["a"] }, ""),
    [
      ["worktreeCleanup.mode", '"off"'],
      ["threadGroups", "{}"],
      ["tags", '["a"]'],
    ],
  );
  assert.deepStrictEqual(flattenSettings(undefined, "missing"), [["missing", "(not set)"]]);
  assert.deepStrictEqual(flattenSettings({}, ""), []);
});
