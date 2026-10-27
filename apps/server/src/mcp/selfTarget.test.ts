import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";

import { selfTargetRefusal } from "./selfTarget.ts";

it("refuses a thread acting on itself", () => {
  const own = ThreadId.make("own");
  expect(selfTargetRefusal(own, own)).toMatch(/own thread/);
  expect(selfTargetRefusal(own, ThreadId.make("other"))).toBeNull();
  expect(selfTargetRefusal(undefined, own)).toBeNull();
});
