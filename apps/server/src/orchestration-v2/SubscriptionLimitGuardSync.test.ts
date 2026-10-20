import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import { subscriptionLimitGuardUpdate } from "./SubscriptionLimitGuardSync.ts";

const threadId = ThreadId.make("thread-guard");
const selection = (enabled: boolean | undefined): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
  ...(enabled === undefined
    ? {}
    : { options: [{ id: "stopAtSubscriptionLimit", value: enabled }] }),
});

const event = (type: string, modelSelection?: ModelSelection) =>
  ({
    type,
    threadId,
    payload: { modelSelection: modelSelection ?? selection(false) },
  }) as OrchestrationV2DomainEvent;

describe("subscriptionLimitGuardUpdate", () => {
  it("follows the thread option on a model selection change", () => {
    assert.deepStrictEqual(
      subscriptionLimitGuardUpdate(event("thread.model-selection-updated", selection(true))),
      { _tag: "set", threadId, enabled: true },
    );
    assert.deepStrictEqual(
      subscriptionLimitGuardUpdate(event("thread.provider-switched", selection(false))),
      { _tag: "set", threadId, enabled: false },
    );
    assert.deepStrictEqual(
      subscriptionLimitGuardUpdate(event("thread.model-selection-updated", selection(undefined))),
      { _tag: "set", threadId, enabled: false },
    );
  });

  it("ignores unrelated events and forgets a deleted thread", () => {
    assert.strictEqual(subscriptionLimitGuardUpdate(event("thread.metadata-updated")), null);
    assert.deepStrictEqual(subscriptionLimitGuardUpdate(event("thread.deleted")), {
      _tag: "clear",
      threadId,
    });
  });
});
