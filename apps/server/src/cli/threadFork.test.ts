import { assert, it } from "@effect/vitest";
import { ComposerContextId, ProviderInstanceId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { launchWorkspaceStrategy, ThreadUsageError } from "./thread.ts";
import { formatTranscript, pendingAnswers } from "./threadFork.ts";
import { contextLinksArgument, orPullRequest } from "./threadForkHooks.ts";

const startStrategy = (input: {
  readonly pr: Option.Option<string>;
  readonly worktree: Option.Option<string>;
  readonly branch: Option.Option<string>;
}) => launchWorkspaceStrategy(input).pipe(orPullRequest(input.pr, ThreadUsageError));

it.effect("start --pr starts from the pull request and refuses --worktree alongside it", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* startStrategy({
        pr: Option.some("42"),
        worktree: Option.none(),
        branch: Option.none(),
      }),
      { type: "pull_request", reference: "42" },
    );
    const both = yield* startStrategy({
      pr: Option.some("42"),
      worktree: Option.some("main"),
      branch: Option.none(),
    }).pipe(Effect.flip);
    assert.strictEqual(both.message, "Pass --pr or --worktree, not both.");
    const branchOnly = yield* startStrategy({
      pr: Option.some("42"),
      worktree: Option.none(),
      branch: Option.some("feature"),
    }).pipe(Effect.flip);
    assert.strictEqual(branchOnly.message, "--branch needs --worktree <base-ref>.");
  }),
);

it("--link turns a bare Linear identifier into a link and passes other links through", () => {
  assert.deepStrictEqual(contextLinksArgument([]), {});
  assert.deepStrictEqual(contextLinksArgument(["eng-123", " https://github.com/o/r/issues/7 "]), {
    contextLinks: ["https://linear.app/_/issue/ENG-123", "https://github.com/o/r/issues/7"],
  });
});

const question = (overrides: Record<string, unknown> = {}) => ({
  id: "q1",
  header: "Plan",
  question: "Which approach?",
  options: [
    { label: "Small", description: "", value: "small" },
    { label: "Large", description: "" },
  ],
  ...overrides,
});

it.effect("--answer picks options by number, label, or value and keeps free text", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* pendingAnswers(
        [question(), question({ id: "q2" }), question({ id: "q3" }), question({ id: "q4" })],
        ["1", "large", "small", "Something else"],
      ),
      { q1: "small", q2: "Large", q3: "small", q4: "Something else" },
    );
    assert.deepStrictEqual(yield* pendingAnswers([question({ multiSelect: true })], ["2, Small"]), {
      q1: ["Large", "small"],
    });
  }),
);

it.effect("--answer refuses text a question does not accept and a wrong answer count", () =>
  Effect.gen(function* () {
    const closed = yield* pendingAnswers([question({ allowCustomAnswer: false })], ["Medium"]).pipe(
      Effect.flip,
    );
    assert.include(closed.message, "Choose from: 1) Small, 2) Large");
    const missing = yield* pendingAnswers([question(), question({ id: "q2" })], ["1"]).pipe(
      Effect.flip,
    );
    assert.include(missing.message, "asks 2 question(s)");
  }),
);

const transcriptThread = {
  title: "Fix login",
  branch: "fix/login",
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
  createdAt: "2026-10-01T10:00:00.000Z",
};

const chip = formatComposerContextReference({
  kind: "linear-issue",
  contextId: ComposerContextId.make("linear-issue_abc"),
  label: "ENG-1",
});

const entries = [
  { type: "user_message", title: null, text: `Fix ${chip} please` },
  { type: "reasoning", title: "Thinking", text: "hmm" },
  { type: "command_execution", title: "Ran command", text: "$ vp test\nok" },
  { type: "file_change", title: "Edited", text: "src/login.ts\n+1 -1\ndiff" },
  { type: "proposed_plan", title: null, text: "1. Do it" },
  { type: "assistant_message", title: null, text: "Done." },
];

it("export keeps only the conversation by default, with chips as their labels", () => {
  assert.strictEqual(
    formatTranscript({
      thread: transcriptThread,
      projectTitle: null,
      entries,
      full: false,
      header: false,
      exportedAt: "2026-10-02T00:00:00.000Z",
    }),
    "# Fix login\n\n## User\n\nFix ENG-1 please\n\n## Assistant\n\nDone.\n",
  );
});

it("export --full --header adds the work log and plans but never reasoning", () => {
  assert.strictEqual(
    formatTranscript({
      thread: transcriptThread,
      projectTitle: "web",
      entries,
      full: true,
      header: true,
      exportedAt: "2026-10-02T00:00:00.000Z",
    }),
    [
      "---",
      'thread: "Fix login"',
      'project: "web"',
      'branch: "fix/login"',
      'provider: "codex"',
      'model: "gpt-5"',
      "created: 2026-10-01T10:00:00.000Z",
      "exported: 2026-10-02T00:00:00.000Z",
      "---",
      "",
      "# Fix login",
      "",
      "## User",
      "",
      "Fix ENG-1 please",
      "",
      "## Assistant",
      "",
      "- **Ran command** `vp test`",
      "- **Edited**: `src/login.ts`",
      "",
      "### Plan",
      "",
      "1. Do it",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
});
