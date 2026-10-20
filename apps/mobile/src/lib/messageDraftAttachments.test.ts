import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../state/atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("../state/assets", () => ({ assetEnvironment: {} }));
vi.mock("../state/session", () => ({ environmentSession: {} }));
vi.mock("./composerImages", () => ({ removePersistedComposerAttachmentFile: vi.fn() }));
vi.mock("./uuid", () => ({ uuidv4: () => "uuid" }));

const { composerAttachmentFromMessageDraft, messageDraftAttachmentsFromPrepared } =
  await import("./messageDraftAttachments");

const environmentId = EnvironmentId.make("env");

describe("messageDraftAttachmentsFromPrepared", () => {
  it("keeps uploaded references and refuses inline image data", () => {
    const uploaded = {
      type: "image",
      id: "att-1",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 10,
    } as const;
    expect(messageDraftAttachmentsFromPrepared([uploaded])).toEqual([uploaded]);
    expect(
      messageDraftAttachmentsFromPrepared([
        { type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: 10, dataUrl: "data:" },
      ]),
    ).toBeNull();
  });
});

describe("composerAttachmentFromMessageDraft", () => {
  it("reuses the server id so context chips and the next send find the same bytes", () => {
    expect(
      composerAttachmentFromMessageDraft({
        environmentId,
        fileUri: "file:///docs/a.png",
        attachment: {
          type: "image",
          id: "att-1",
          name: "a.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      }),
    ).toEqual({
      type: "image",
      id: "att-1",
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 5,
      fileUri: "file:///docs/a.png",
      previewUri: "file:///docs/a.png",
      uploadedAttachmentId: "att-1",
      uploadEnvironmentId: environmentId,
    });
  });

  it("keeps a pasted-text file's source", () => {
    expect(
      composerAttachmentFromMessageDraft({
        environmentId,
        fileUri: "file:///docs/paste.txt",
        attachment: {
          type: "file",
          id: "att-2",
          name: "paste.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          source: { _tag: "pasted-text" },
        },
      }),
    ).toMatchObject({ type: "file", source: { _tag: "pasted-text" } });
  });
});
