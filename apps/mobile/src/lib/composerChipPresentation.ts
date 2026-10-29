import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";

import type { CONTEXT_CHIP_ICON_SOURCES } from "./contextChipIcons.generated";
import { resolveMarkdownFileIcon, type MarkdownFileIcon } from "./markdownLinks";
import {
  flattenThemeColor,
  isDarkThemeColor,
  themeAccentWithContrast,
  type MobileThemeVariables,
} from "./mobileTheme";

export type ContextChipIcon = keyof typeof CONTEXT_CHIP_ICON_SOURCES;

interface ContextChipPresentation {
  readonly accent?: string;
  readonly icon: ContextChipIcon | null;
}

/**
 * These are the sRGB form of the same OKLCH set web uses, so a chip looks the same on every
 * surface. See `ContextChip.tsx`.
 */
const CONTEXT_CHIP_PRESENTATIONS = {
  image: { accent: "#0090cd", icon: "image" },
  video: { accent: "#d06217", icon: "film" },
  file: { accent: "#0090cd", icon: null },
  mention: { accent: "#0096af", icon: null },
  terminal: { accent: "#009f6e", icon: "terminal" },
  element: { accent: "#b87501", icon: "mouse-pointer-click" },
  "preview-annotation": {
    accent: "#b87501",
    icon: "mouse-pointer-click",
  },
  "review-comment": { accent: "#8a70dd", icon: "message-circle" },
  "pull-request": {
    accent: "#7079e4",
    icon: "git-pull-request-arrow",
  },
  skill: { accent: "#b261be", icon: "skill" },
  "linear-issue": { accent: "#617de6", icon: "ticket" },
  "linear-object": { accent: "#617de6", icon: "ticket" },
  "github-issue": { accent: "#009f6e", icon: "circle-dot" },
  "google-file": { accent: "#4585dc", icon: "google-doc" },
  "github-ref": { accent: "#7f8793", icon: "tag" },
  "slack-thread": { accent: "#c6589c", icon: "hash" },
  "discord-thread": { accent: "#5865F2", icon: "messages-square" },
  repository: { accent: "#009c9c", icon: "folder-git-2" },
  checkout: { accent: "#0096af", icon: "laptop" },
  "unread-link": { accent: "#d55665", icon: "link" },
  model: { accent: "#d06217", icon: "cpu" },
  thread: {
    accent: "#009c96",
    icon: "messages-square",
  },
  // A machine: the record carries only its identity, so every machine wears one glyph.
  environment: { accent: "#3f9a4f", icon: "server" },
} as const satisfies Record<string, ContextChipPresentation>;

const CHIP_CONTRAST = 5;

const readableChipAccents = new Map<string, string>();

/**
 * A chip keeps one color per theme so it looks the same in a message, a reply and the composer,
 * which means it must read on all of them; the user bubble is usually the hardest. A surface
 * whose text is the opposite shade, like Material You's primary-colored light bubble, can't share
 * a color with the canvas, so chips are matched only against surfaces like the one they sit on.
 */
export function contextChipAccent(
  accent: string | undefined,
  theme: MobileThemeVariables,
  textColor: string,
): string | undefined {
  if (!accent) return undefined;
  const screen = theme["--color-screen"];
  const darkText = isDarkThemeColor(textColor);
  const surfaces = (
    [
      ["--color-user-bubble", "--color-user-bubble-foreground"],
      ["--color-thread-canvas", "--color-md-body"],
      ["--color-composer-surface", "--color-foreground"],
    ] as const
  )
    .filter(([, text]) => isDarkThemeColor(theme[text]) === darkText)
    .map(([surface]) => flattenThemeColor(theme[surface], screen));
  const key = [accent, ...surfaces].join();
  let readable = readableChipAccents.get(key);
  if (readable === undefined) {
    readable = themeAccentWithContrast(accent, surfaces, CHIP_CONTRAST);
    readableChipAccents.set(key, readable);
  }
  return readable;
}

export const UNAVAILABLE_CONTEXT_CHIP_PRESENTATION: ContextChipPresentation = {
  icon: "circle-dashed",
};

export function composerChipSizeSuffix(record?: {
  readonly kind?: string;
  readonly sizeBytes?: number;
}): string {
  if (record?.kind !== "file" && record?.kind !== "image") return "";
  return typeof record.sizeBytes === "number" ? formatAttachmentSize(record.sizeBytes) : "";
}

const PULL_REQUEST_CHIP_PRESENTATIONS = {
  open: { accent: "#009f6e", icon: "git-pull-request-arrow" },
  draft: { accent: "#7f8793", icon: "git-pull-request-draft" },
  merged: { accent: "#8a70dd", icon: "git-merge" },
  closed: { accent: "#d55665", icon: "git-pull-request-closed" },
} as const satisfies Record<string, ContextChipPresentation>;

/** A release uses the tag it publishes; both native surfaces share the same glyph assets. */
const GITHUB_REF_CHIP_ICONS = {
  release: "tag",
  tag: "tag",
  branch: "git-branch",
  commit: "git-commit-horizontal",
} as const;

/** A GitHub issue chip is green while open and purple once closed, the way GitHub colours it. */
const CLOSED_GITHUB_ISSUE_CHIP_PRESENTATION = {
  accent: "#8a70dd",
  icon: "circle-dot",
} as const;

export function contextChipPresentation(
  kind: string,
  record?: {
    readonly kind?: string;
    readonly name?: string;
    readonly mimeType?: string;
    readonly sectionId?: string;
    readonly state?: string;
    readonly refType?: string;
    readonly fileType?: string;
    readonly pullRequest?: {
      readonly state?: string;
      readonly isDraft?: boolean;
    };
  },
): ContextChipPresentation {
  if (kind === "google-file" && record?.fileType === "email")
    return { accent: "#ea4335", icon: "gmail" };
  if (kind === "google-file" && record?.fileType === "event")
    return { accent: "#4585dc", icon: "google-calendar" };
  if (kind === "google-file" && record?.fileType !== "doc" && record?.fileType !== "sheet")
    return { accent: "#7f8793", icon: "google-drive" };
  if (kind === "google-file" && record?.fileType === "sheet")
    return { accent: "#319e63", icon: "google-sheet" };
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
  if (
    presentationKind === "github-ref" &&
    record?.refType !== undefined &&
    Object.hasOwn(GITHUB_REF_CHIP_ICONS, record.refType)
  ) {
    return {
      ...CONTEXT_CHIP_PRESENTATIONS["github-ref"],
      icon: GITHUB_REF_CHIP_ICONS[record.refType as keyof typeof GITHUB_REF_CHIP_ICONS],
    };
  }
  if (presentationKind === "github-issue" && record?.state === "closed") {
    return CLOSED_GITHUB_ISSUE_CHIP_PRESENTATION;
  }
  return Object.hasOwn(CONTEXT_CHIP_PRESENTATIONS, presentationKind)
    ? CONTEXT_CHIP_PRESENTATIONS[presentationKind as keyof typeof CONTEXT_CHIP_PRESENTATIONS]
    : UNAVAILABLE_CONTEXT_CHIP_PRESENTATION;
}

export type ContextChipIconRef =
  | { readonly kind: "chip"; readonly name: ContextChipIcon }
  | { readonly kind: "file"; readonly name: MarkdownFileIcon };

export function contextChipIcon(
  presentation: Pick<ContextChipPresentation, "icon">,
  fileName: string,
): ContextChipIconRef {
  return presentation.icon
    ? { kind: "chip", name: presentation.icon }
    : { kind: "file", name: resolveMarkdownFileIcon(fileName) };
}

export function contextRecordFileName(record?: object): string {
  if (record && "path" in record && typeof record.path === "string") return record.path;
  if (record && "name" in record && typeof record.name === "string") return record.name;
  return "";
}
