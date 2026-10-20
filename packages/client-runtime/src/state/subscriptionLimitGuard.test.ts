import { type ModelSelection, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadSubscriptionLimitGuard,
  withSubscriptionLimitOption,
} from "./subscriptionLimitGuard.ts";

const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
  options: [{ id: "effort", value: "high" }],
};

const provider = (optionIds: ReadonlyArray<string>) =>
  ({
    models: [
      {
        slug: "claude-opus-4-6",
        capabilities: {
          optionDescriptors: optionIds.map((id) => ({ id, label: id, type: "boolean" })),
        },
      },
    ],
  }) as unknown as ServerProvider;

describe("resolveThreadSubscriptionLimitGuard", () => {
  it("is unavailable where the provider does not advertise the option", () => {
    expect(
      resolveThreadSubscriptionLimitGuard({
        provider: provider(["effort"]),
        selection,
        appSettingEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveThreadSubscriptionLimitGuard({
        provider: undefined,
        selection,
        appSettingEnabled: false,
      }),
    ).toBeNull();
  });

  it("reports the thread's option and whether the app setting enforces it", () => {
    const supported = provider(["stopAtSubscriptionLimit"]);
    expect(
      resolveThreadSubscriptionLimitGuard({
        provider: supported,
        selection,
        appSettingEnabled: true,
      }),
    ).toEqual({ enabled: false, enforcedByApp: true });
    expect(
      resolveThreadSubscriptionLimitGuard({
        provider: supported,
        selection: withSubscriptionLimitOption(selection, true),
        appSettingEnabled: false,
      }),
    ).toEqual({ enabled: true, enforcedByApp: false });
  });
});

describe("withSubscriptionLimitOption", () => {
  it("replaces only the guard option and keeps the model", () => {
    const on = withSubscriptionLimitOption(selection, true);
    const off = withSubscriptionLimitOption(on, false);
    expect(off).toEqual({
      ...selection,
      options: [
        { id: "effort", value: "high" },
        { id: "stopAtSubscriptionLimit", value: false },
      ],
    });
  });
});
