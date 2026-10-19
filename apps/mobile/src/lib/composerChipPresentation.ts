import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";
/**
 * These are the sRGB form of the same OKLCH set web uses, so a chip looks the same on every
 * surface. See `composerInlineChip.ts`.
 */
const CONTEXT_CHIP_PRESENTATIONS = {
  image: { accent: "#d55665", symbol: "photo" },
  video: { accent: "#d06217", symbol: "play.rectangle" },
  file: { accent: "#0090cd", symbol: "doc" },
  mention: { accent: "#0096af", symbol: "doc" },
  terminal: { accent: "#009f6e", symbol: "terminal" },
  element: { accent: "#b87501", symbol: "cursorarrow.click" },
  "preview-annotation": { accent: "#b87501", symbol: "cursorarrow.click" },
  "review-comment": { accent: "#8a70dd", symbol: "text.bubble" },
  "pull-request": { accent: "#7079e4", symbol: "git-pull-request" },
  skill: { accent: "#b261be", symbol: "cube" },
  "linear-issue": { accent: "#617de6", symbol: "ticket" },
  "github-issue": { accent: "#009f6e", symbol: "smallcircle.filled.circle" },
  "slack-thread": { accent: "#c6589c", symbol: "number" },
  repository: { accent: "#009c9c", symbol: "folder" },
  checkout: { accent: "#0096af", symbol: "laptopcomputer" },
} as const;

export function composerChipSizeSuffix(record?: {
  readonly kind?: string;
  readonly sizeBytes?: number;
}): string {
  if (record?.kind !== "file" && record?.kind !== "image") return "";
  return typeof record.sizeBytes === "number" ? formatAttachmentSize(record.sizeBytes) : "";
}

const PULL_REQUEST_CHIP_PRESENTATIONS = {
  open: { accent: "#009f6e", symbol: "git-pull-request" },
  draft: { accent: "#7f8793", symbol: "git-pull-request" },
  merged: { accent: "#8a70dd", symbol: "git-pull-request" },
  closed: { accent: "#d55665", symbol: "git-pull-request" },
} as const;

/** A GitHub issue chip is green while open and purple once closed, the way GitHub colours it. */
const CLOSED_GITHUB_ISSUE_CHIP_PRESENTATION = {
  accent: "#8a70dd",
  symbol: "smallcircle.filled.circle",
} as const;

export function contextChipPresentation(
  kind: string,
  record?: {
    readonly kind?: string;
    readonly name?: string;
    readonly mimeType?: string;
    readonly sectionId?: string;
    readonly state?: string;
    readonly pullRequest?: {
      readonly state?: string;
      readonly isDraft?: boolean;
    };
  },
) {
  const presentationKind =
    kind === "file" &&
    videoMimeType({
      name: record?.name ?? "",
      mimeType: record?.mimeType ?? "",
    })
      ? "video"
      : kind === "file" &&
          imageMimeType({ name: record?.name ?? "", mimeType: record?.mimeType ?? "" }) !== null
        ? "image"
        : kind === "review-comment" && record?.sectionId?.startsWith("pull-request:")
          ? "pull-request"
          : kind;
  if (presentationKind === "pull-request") {
    const pullRequest = record?.pullRequest;
    const state =
      pullRequest?.state === "open" && pullRequest.isDraft === true
        ? "draft"
        : (pullRequest?.state ?? "");
    if (Object.hasOwn(PULL_REQUEST_CHIP_PRESENTATIONS, state)) {
      return PULL_REQUEST_CHIP_PRESENTATIONS[state as keyof typeof PULL_REQUEST_CHIP_PRESENTATIONS];
    }
  }
  if (presentationKind === "github-issue" && record?.state === "closed") {
    return CLOSED_GITHUB_ISSUE_CHIP_PRESENTATION;
  }
  return Object.hasOwn(CONTEXT_CHIP_PRESENTATIONS, presentationKind)
    ? CONTEXT_CHIP_PRESENTATIONS[presentationKind as keyof typeof CONTEXT_CHIP_PRESENTATIONS]
    : CONTEXT_CHIP_PRESENTATIONS.file;
}
