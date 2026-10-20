import type { ChatFileAttachment, ChatImageAttachment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachmentContextRecord } from "../../lib/composerContextRecords";
import { messageDraftComposerRecords } from "./messageDraftComposer";

const image: ChatImageAttachment = {
  type: "image",
  id: "thread-1-image",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 10,
};
const file: ChatFileAttachment = {
  type: "file",
  id: "thread-1-file",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 4,
};

describe("messageDraftComposerRecords", () => {
  it("keeps the draft's own attachment records", () => {
    const record = attachmentContextRecord({ attachment: image, attachmentId: image.id });
    expect(
      messageDraftComposerRecords({
        attachments: [image],
        context: { version: 1, records: [record] },
      }),
    ).toEqual([record]);
  });

  it("adds records for attachments saved without one, so opening keeps them", () => {
    const records = messageDraftComposerRecords({ attachments: [image, file] });
    expect(
      records.map((record) => [record.kind, "attachmentId" in record && record.attachmentId]),
    ).toEqual([
      ["image", image.id],
      ["file", file.id],
    ]);
  });
});
