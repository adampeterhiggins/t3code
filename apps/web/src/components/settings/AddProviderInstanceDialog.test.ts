import { describe, expect, it } from "vite-plus/test";

import { resolveWizardNavigation } from "./AddProviderInstanceDialog.logic";

describe("resolveWizardNavigation", () => {
  const invalidId = { instanceIdError: "Instance ID is required." };
  const validId = { instanceIdError: null };

  it("allows moving from Driver to Identity before the instance id is valid", () => {
    expect(resolveWizardNavigation(0, 1, 3, invalidId)).toEqual({ kind: "navigate", step: 1 });
  });

  it("blocks Next from Identity to Config while the instance id is invalid", () => {
    expect(resolveWizardNavigation(1, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });

  it("stops a direct Driver-to-Config skip at Identity and surfaces its error", () => {
    expect(resolveWizardNavigation(0, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });

  it("allows advancing and skipping forward once the instance id is valid", () => {
    expect(resolveWizardNavigation(1, 2, 3, validId)).toEqual({ kind: "navigate", step: 2 });
    expect(resolveWizardNavigation(0, 2, 3, validId)).toEqual({ kind: "navigate", step: 2 });
  });

  it("always preserves backward Driver and Identity navigation", () => {
    expect(resolveWizardNavigation(2, 1, 3, invalidId)).toEqual({ kind: "navigate", step: 1 });
    expect(resolveWizardNavigation(2, 0, 3, invalidId)).toEqual({ kind: "navigate", step: 0 });
    expect(resolveWizardNavigation(1, 0, 3, invalidId)).toEqual({ kind: "navigate", step: 0 });
  });

  it("clamps requested steps to the wizard bounds", () => {
    expect(resolveWizardNavigation(2, 8, 3, validId)).toEqual({ kind: "navigate", step: 2 });
    expect(resolveWizardNavigation(0, -1, 3, invalidId)).toEqual({ kind: "navigate", step: 0 });
  });

  it("keeps the sign-in step unreachable while navigation is capped at Config", () => {
    // Before the instance exists the caller passes stepCount=3 even though the
    // wizard shows four steps, so a "Sign in" header click lands on Config.
    expect(resolveWizardNavigation(0, 3, 3, validId)).toEqual({ kind: "navigate", step: 2 });
    expect(resolveWizardNavigation(1, 3, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });

  it("locks navigation onto the sign-in step once the instance exists", () => {
    // After creation the caller passes stepCount=4 and minStep=3: backward
    // clicks resolve to the sign-in step instead of walking the wizard back.
    expect(resolveWizardNavigation(3, 0, 4, validId, 3)).toEqual({ kind: "navigate", step: 3 });
    expect(resolveWizardNavigation(3, 2, 4, validId, 3)).toEqual({ kind: "navigate", step: 3 });
  });
});
