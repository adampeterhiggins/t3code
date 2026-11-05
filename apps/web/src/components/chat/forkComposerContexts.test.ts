import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { expect, it } from "vite-plus/test";

import { type ComposerImageAttachment, useComposerDraftStore } from "../../composerDraftStore";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { imageContextReference, threadContextReference } from "../../lib/composerContextRecords";
import { dropTextAttachments, referencedDraftContent } from "./forkComposerContexts";

const environmentId = EnvironmentId.make("environment");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread"));

function image(id: string): ComposerImageAttachment {
  const file = new File([new Uint8Array([1])], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
  };
}

const chip = (reference: Parameters<typeof formatInlineContextReference>[0]) =>
  formatInlineContextReference(reference);

const shared = image("shared");
const quoted = image("quoted");
const linked = threadContextRecord(
  { environmentId, threadId: ThreadId.make("linked") },
  "Linked thread",
);
const citation = serializeAssistantCitation(
  withAssistantCitationComment(
    {
      version: 1,
      environmentId,
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      text: "hello",
      start: 0,
      end: 5,
      prefix: "",
      suffix: "",
    },
    `See ${chip(imageContextReference(quoted))} ${chip(imageContextReference(shared))} and ${chip(
      threadContextReference(linked),
    )}`,
  ),
);
const draft = {
  images: [shared, quoted, image("unrelated")],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [
    linked,
    threadContextRecord({ environmentId, threadId: ThreadId.make("other") }, "Other"),
  ],
  environmentContexts: [],
};

it("takes only what a quote's comment names, and leaves what the prompt still names", () => {
  const content = referencedDraftContent(draft, citation);
  expect(content.images.map((attachment) => attachment.id)).toEqual(["shared", "quoted"]);
  expect(content.threadContexts).toEqual([linked]);

  const store = useComposerDraftStore.getState();
  store.addImages(threadRef, [...draft.images]);
  dropTextAttachments({
    draftTarget: threadRef,
    attachments: content.images,
    // The prompt left behind once the quote went still shows the shared image.
    remainingPrompt: `Also ${chip(imageContextReference(shared))}`,
    release: false,
  });
  expect(store.getComposerDraft(threadRef)?.images.map((attachment) => attachment.id)).toEqual([
    "shared",
    "unrelated",
  ]);
});
