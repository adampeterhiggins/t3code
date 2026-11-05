import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { MessageId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import {
  collectAssistantCitationComments,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the timeout.
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx. The app keeps its
// connection for the whole file, so the threads served here are this file's only fixture.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("a citation comment's @ menu puts the chip in the comment", async () => {
  using _environment = installFakeEnvironment([
    threadWithHistory("alpha", 1),
    threadWithHistory("beta", 1),
  ]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  localStorage.removeItem("t3code:citation-comment-submit:v1");
  const alpha = ThreadId.make("alpha");
  const citation = {
    version: 1 as const,
    environmentId: ENVIRONMENT_ID,
    threadId: alpha,
    messageId: MessageId.make("alpha-assistant-0"),
    text: "Answer 0",
    start: 0,
    end: 8,
    prefix: "",
    suffix: "",
  };
  const threadRef = scopeThreadRef(ENVIRONMENT_ID, alpha);
  useComposerDraftStore
    .getState()
    .setPrompt(threadRef, `See ${serializeAssistantCitation(citation)} `);

  const router = getRouter(createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/alpha`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await page.getByLabelText("Add comment to citation").click();
  const comment = page.getByLabelText("Comment on selected text");
  await expect.element(comment).toHaveFocus();
  await userEvent.keyboard("@beta");
  // The fake server never answers a file search, so the menu waits on Files.
  await page.getByRole("tab", { name: "Chats" }).click();
  await expect.element(page.getByRole("option", { name: /Thread beta/ })).toBeVisible();
  // Enter picks from the menu while it is open, and saves the comment once it closed.
  await userEvent.keyboard("{Enter}");
  await expect.element(comment.getByText("Thread beta")).toBeVisible();
  await userEvent.keyboard("{Enter}");

  const prompt = useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "";
  const [saved] = collectAssistantCitationComments(prompt);
  expect(saved).toContain(
    threadContextRecord(scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("beta")), "").contextId,
  );
  // The chip went into the comment, not beside the citation in the prompt.
  expect(prompt.startsWith("See [")).toBe(true);
  expect(prompt.endsWith(") ")).toBe(true);
});
