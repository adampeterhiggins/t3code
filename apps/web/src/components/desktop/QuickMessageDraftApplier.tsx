import { useAtomValue } from "@effect/atom-react";
import type {
  DesktopQuickMessageAttachment,
  DesktopQuickMessageStartFrom,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useEffectEvent } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useAttachDiscordMessage } from "../chat/DiscordMessagePicker";
import { useAttachGitHubIssue } from "../chat/GitHubIssuePicker";
import { useAttachGranolaNote } from "../chat/GranolaNotePicker";
import { useAttachLinearIssue } from "../chat/LinearIssuePicker";
import { useAttachNotionPage } from "../chat/NotionPagePicker";
import { useAttachGoogleFile } from "../chat/GoogleFilePicker";
import { attachRepository } from "../chat/RepositoryAttachPicker";
import { useAttachSlackMessage } from "../chat/SlackMessagePicker";
import { useApplyStartFrom } from "../chat/StartFromPicker";
import type { resolveBranchStart } from "../chat/StartFromPicker.logic";
import { createThreadAttachSummaryLoader } from "../chat/threadAttachPickerSummary";
import { useCaptureThreadTabContext } from "../chat/ThreadTabs";
import { attachStoredModelToChat } from "../chat/modelReferences";
import { useAttachCheckout } from "../chat/useComposerCheckoutItems";
import { toastManager } from "../ui/toast";

interface PendingQuickMessageDraft {
  readonly threadRef: ScopedThreadRef;
  readonly startFrom: DesktopQuickMessageStartFrom | undefined;
  readonly attachments: ReadonlyArray<DesktopQuickMessageAttachment>;
  /** False when the start point or an attachment did not take, so the draft should not send. */
  readonly onApplied: (applied: boolean) => void;
}

/** What the quick message panel picked for a new draft, waiting for that draft's chat view. */
const pendingQuickMessageDraftAtom = Atom.make<PendingQuickMessageDraft | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("desktop:pending-quick-message-draft"),
);

/** Applies the panel's picks to a new draft once its chat view mounts, as if picked there. */
export function applyQuickMessageToDraft(pending: PendingQuickMessageDraft): void {
  appAtomRegistry.set(pendingQuickMessageDraftAtom, pending);
}

/**
 * Mounted by a local draft's chat view. Runs the same checkouts and attaches the draft's own
 * pickers would, against this draft, for picks the quick message panel made without one.
 */
export function QuickMessageDraftApplier(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly threadRef: ScopedThreadRef;
  readonly onCheckout: (checkout: ReturnType<typeof resolveBranchStart>) => void;
}) {
  const { threadRef } = props;
  const pending = useAtomValue(pendingQuickMessageDraftAtom);
  const applyStartFrom = useApplyStartFrom(props);
  const attach = useApplyAttachment(threadRef);

  const apply = useEffectEvent(async (next: PendingQuickMessageDraft) => {
    appAtomRegistry.set(pendingQuickMessageDraftAtom, null);
    // A pull request is checked out first, so nothing is attached or sent in the old checkout.
    // That can take a while, and until it lands the draft still shows the project's checkout.
    const checkoutToastId =
      next.startFrom?.type === "pull-request"
        ? toastManager.add({
            type: "loading",
            title: `Checking out #${next.startFrom.number}...`,
          })
        : null;
    let applied =
      next.startFrom === undefined ||
      (await applyStartFrom(next.startFrom).finally(() => {
        if (checkoutToastId !== null) toastManager.close(checkoutToastId);
      }));
    for (const attachment of next.attachments) {
      if (!(await attach(attachment))) applied = false;
    }
    next.onApplied(applied);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- runs the main window's handoff once this draft's view is mounted
  useEffect(() => {
    if (
      pending !== null &&
      pending.threadRef.environmentId === threadRef.environmentId &&
      pending.threadRef.threadId === threadRef.threadId
    ) {
      void apply(pending);
    }
  }, [pending, threadRef.environmentId, threadRef.threadId]);

  return null;
}

function useApplyAttachment(threadRef: ScopedThreadRef) {
  const attachLinearIssue = useAttachLinearIssue();
  const attachNotionPage = useAttachNotionPage();
  const attachGoogleFile = useAttachGoogleFile();
  const attachGranolaNote = useAttachGranolaNote();
  const attachSlackMessage = useAttachSlackMessage();
  const attachDiscordMessage = useAttachDiscordMessage();
  const attachGitHubIssue = useAttachGitHubIssue();
  const shell = useThreadShell(threadRef);
  const driver =
    useEnvironmentProviders()
      .get(threadRef.environmentId)
      ?.find((provider) => provider.instanceId === shell?.modelSelection.instanceId)?.driver ??
    null;
  const attachCheckout = useAttachCheckout(driver);
  const captureContext = useCaptureThreadTabContext(threadRef.environmentId, threadRef.threadId);

  return async (attachment: DesktopQuickMessageAttachment): Promise<boolean> => {
    switch (attachment.type) {
      case "thread": {
        if (captureContext === null) return false;
        try {
          const summary = await createThreadAttachSummaryLoader(captureContext.fetchSummary)(
            attachment.threadId,
          );
          const reference = await captureContext.capture(
            attachment.threadId,
            attachment.label,
            summary,
          );
          useComposerDraftStore.getState().insertContextReference(threadRef, reference);
          return true;
        } catch (cause) {
          toastManager.add({
            type: "error",
            title: "Could not attach that thread",
            description: cause instanceof Error ? cause.message : undefined,
          });
          return false;
        }
      }
      case "linear-issue":
        return attachLinearIssue(threadRef, attachment.issueId);
      case "notion-page":
        return attachNotionPage(threadRef, attachment.pageId);
      case "google-file":
        return attachGoogleFile(threadRef, attachment.fileId);
      case "granola-note":
        return attachGranolaNote(threadRef, attachment.noteId);
      case "slack-message":
        return attachSlackMessage(threadRef, attachment.input);
      case "discord-message":
        return attachDiscordMessage(threadRef, attachment.input);
      case "github-issue":
        return attachGitHubIssue(threadRef, attachment.url);
      case "pull-request":
        useComposerDraftStore.getState().addReviewComment(threadRef, attachment.comment);
        return true;
      case "checkout":
        attachCheckout(threadRef, { ...attachment, selectable: true }, { link: attachment.link });
        return true;
      case "repository":
        attachRepository(threadRef, attachment);
        return true;
      case "model":
        attachStoredModelToChat(threadRef, {
          providerInstanceId: attachment.providerInstanceId,
          driver: attachment.driver,
          instanceName: attachment.instanceName,
          model: attachment.model,
          modelName: attachment.label,
        });
        return true;
    }
  };
}
