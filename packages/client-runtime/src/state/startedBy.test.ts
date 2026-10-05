import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopeThreadRef } from "../environment/scoped.ts";
import { resolveStartedBy, startedByThreadRef } from "./startedBy.ts";

const environmentId = EnvironmentId.make("environment-1");
const starterId = ThreadId.make("thread-starter");
const startedByThread = {
  environmentId,
  startedBy: { kind: "thread" as const, threadId: starterId },
};

describe("resolveStartedBy", () => {
  it("attributes nothing to threads the user started", () => {
    expect(resolveStartedBy({ environmentId, startedBy: null }, null)).toBeNull();
    expect(resolveStartedBy(null, null)).toBeNull();
    expect(startedByThreadRef({ environmentId, startedBy: null })).toBeNull();
  });

  it("names the starting thread and opens it when it is loaded", () => {
    expect(startedByThreadRef(startedByThread)).toEqual(scopeThreadRef(environmentId, starterId));
    expect(resolveStartedBy(startedByThread, { title: "Plan the release" })).toEqual({
      label: "Plan the release",
      description: "Started by the agent in Plan the release",
      openRef: scopeThreadRef(environmentId, starterId),
    });
  });

  it("falls back to an archived thread with nothing to open when the starter is not loaded", () => {
    expect(resolveStartedBy(startedByThread, null)).toEqual({
      label: "an archived thread",
      description: "Started by the agent in an archived thread",
      openRef: null,
    });
  });

  it("names the agent access token for agents outside T3 Code", () => {
    const thread = {
      environmentId,
      startedBy: { kind: "agent-access" as const, label: "Nightly triage" },
    };
    expect(startedByThreadRef(thread)).toBeNull();
    expect(resolveStartedBy(thread, null)).toEqual({
      label: "Nightly triage",
      description: "Started by the agent using Nightly triage",
      openRef: null,
    });
  });
});
