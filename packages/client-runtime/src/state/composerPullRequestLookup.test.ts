import { describe, expect, it } from "vite-plus/test";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { createComposerPullRequestLookupAtomFamily } from "./pullRequests.ts";

describe("composer numeric lookup", () => {
  it("keeps successes visible while other repositories load or fail", () => {
    const successful = Atom.make(AsyncResult.success({ number: 6310, repository: "linked/repo" }));
    const pending = Atom.make<
      AsyncResult.AsyncResult<{ number: number; repository: string }, string>
    >(AsyncResult.initial<{ number: number; repository: string }, string>(true));
    const failed = Atom.make(AsyncResult.failure(Cause.fail("not found")));
    const lookup = createComposerPullRequestLookupAtomFamily(({ input }) =>
      input.repository === "linked/repo"
        ? successful
        : input.repository === "pending/repo"
          ? pending
          : failed,
    );
    const registry = AtomRegistry.make();
    const atom = lookup(
      JSON.stringify(
        ["linked/repo", "pending/repo", "missing/repo"].map((repository) => ({
          environmentId: "env",
          input: { projectId: "project", repository, host: "github.com", number: 6310 },
        })),
      ),
    );
    const unmount = registry.mount(atom);
    expect(registry.get(atom)).toEqual({
      entries: [{ number: 6310, repository: "linked/repo" }],
      isPending: true,
    });
    registry.set(pending, AsyncResult.failure(Cause.fail("unavailable")));
    expect(registry.get(atom)).toEqual({
      entries: [{ number: 6310, repository: "linked/repo" }],
      isPending: false,
    });
    expect(registry.get(lookup("[]"))).toEqual({ entries: [], isPending: false });
    unmount();
    registry.dispose();
  });
});
