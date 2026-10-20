import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import {
  MessageDraftError,
  type ChatAttachment,
  type EnvironmentId,
  type MessageDraft,
  type MessageDraftId,
  type MessageDraftSendMode,
  type OrchestrationMessageContext,
  type ThreadId,
} from "@t3tools/contracts";

import { LOCAL_MESSAGE_DRAFT_ORIGIN, messageDraftEnvironment } from "../../state/messageDrafts";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface MessageDraftContent {
  readonly threadId: ThreadId;
  readonly text: string;
  /** Pending upload ids, or attachments the thread already owns. */
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}

const isMessageDraftError = Schema.is(MessageDraftError);

function failureMessage(error: unknown) {
  if (isMessageDraftError(error) && error.reason === "not-found") {
    return "This draft was already opened or sent on another device";
  }
  return error instanceof Error && error.message.trim().length > 0 ? error.message : null;
}

/**
 * The draft RPCs with this client's failure toasts. Each resolves to whether it worked (or the
 * taken draft), so callers only decide what to do with their own UI.
 */
export function useMessageDraftActions() {
  const saveCommand = useAtomCommand(messageDraftEnvironment.save, { reportFailure: false });
  const takeCommand = useAtomCommand(messageDraftEnvironment.take, { reportFailure: false });
  const removeCommand = useAtomCommand(messageDraftEnvironment.remove, { reportFailure: false });
  const sendCommand = useAtomCommand(messageDraftEnvironment.send, { reportFailure: false });

  const reportFailure = (title: string, description: string | null) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        ...(description === null ? {} : { description }),
      }),
    );
  };

  const save = async (
    environmentId: EnvironmentId,
    content: MessageDraftContent,
  ): Promise<MessageDraft | null> => {
    const result = await saveCommand({
      environmentId,
      input: {
        threadId: content.threadId,
        text: content.text,
        attachments: content.attachments,
        ...(content.context === undefined ? {} : { context: content.context }),
        origin: LOCAL_MESSAGE_DRAFT_ORIGIN,
      },
    });
    if (result._tag === "Success") return result.value;
    reportFailure("Could not save the draft", failureMessage(squashAtomCommandFailure(result)));
    return null;
  };

  const take = async (
    environmentId: EnvironmentId,
    draftId: MessageDraftId,
  ): Promise<MessageDraft | null> => {
    const result = await takeCommand({ environmentId, input: { draftId } });
    if (result._tag === "Success") return result.value;
    reportFailure("Could not open the draft", failureMessage(squashAtomCommandFailure(result)));
    return null;
  };

  const remove = async (environmentId: EnvironmentId, draftId: MessageDraftId) => {
    const result = await removeCommand({ environmentId, input: { draftId } });
    if (result._tag === "Success") return true;
    reportFailure("Could not delete the draft", failureMessage(squashAtomCommandFailure(result)));
    return false;
  };

  const send = async (
    environmentId: EnvironmentId,
    draftId: MessageDraftId,
    mode: MessageDraftSendMode,
  ) => {
    const result = await sendCommand({ environmentId, input: { draftId, mode } });
    if (result._tag === "Success") return true;
    reportFailure("Could not send the draft", failureMessage(squashAtomCommandFailure(result)));
    return false;
  };

  return { save, take, remove, send };
}
