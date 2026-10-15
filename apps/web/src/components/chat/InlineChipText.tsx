import {
  assistantCitationLabel,
  collectAssistantCitations,
} from "@t3tools/shared/assistantCitations";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  BotIcon,
  FileIcon,
  FolderGit2Icon,
  FolderIcon,
  ImageIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  MousePointerClickIcon,
  QuoteIcon,
  TerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ContextChip, ContextChipLabel, type ContextChipKind } from "../ContextChip";
import { GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "../Icons";
import { SkillChipIcon } from "./SkillInlineText";

const CHIP_ICONS: Partial<Record<ContextChipKind, ReactNode>> = {
  image: <ImageIcon />,
  file: <FileIcon />,
  mention: <FileIcon />,
  terminal: <TerminalIcon />,
  element: <MousePointerClickIcon />,
  "preview-annotation": <MousePointerClickIcon />,
  "review-comment": <MessageCircleIcon />,
  skill: <SkillChipIcon />,
  thread: <MessagesSquareIcon />,
  "thread-tab": <MessagesSquareIcon />,
  subagent: <BotIcon />,
  "prompt-link": <MessageSquareTextIcon />,
  "linear-issue": <LinearIcon />,
  "github-issue": <GitHubIcon />,
  "slack-thread": <SlackIcon />,
  "notion-page": <NotionIcon />,
  "granola-note": <GranolaIcon />,
  repository: <FolderGit2Icon />,
  checkout: <FolderIcon />,
  citation: <QuoteIcon />,
};

// The chip's align-middle centers it on the x-height, which reads low beside one-line text;
// lift it to the cap-height center.
const CHIP_ALIGN = "-translate-y-[0.1em]";

type Segment = { start: number; end: number; kind: ContextChipKind; label: string };

/**
 * One-line message text with its context references and assistant quotes drawn as static
 * chips, for previews that have no records to open (queued messages). `hideImages` drops
 * image references a surface already shows as thumbnails.
 */
export function InlineChipText({ text, hideImages }: { text: string; hideImages?: boolean }) {
  const segments: Segment[] = [
    ...collectComposerContextReferences(text).map((reference) => ({
      start: reference.start,
      end: reference.end,
      kind: reference.kind in CHIP_ICONS ? (reference.kind as ContextChipKind) : "neutral",
      label: hideImages && reference.kind === "image" ? "" : reference.label,
    })),
    ...collectAssistantCitations(text).map((match) => ({
      start: match.start,
      end: match.end,
      kind: "citation" as const,
      label: assistantCitationLabel(match.citation),
    })),
  ].toSorted((a, b) => a.start - b.start);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor) continue;
    parts.push(text.slice(cursor, segment.start));
    if (segment.label) {
      parts.push(
        <ContextChip key={segment.start} kind={segment.kind} className={CHIP_ALIGN}>
          {CHIP_ICONS[segment.kind]}
          <ContextChipLabel>{segment.label}</ContextChipLabel>
        </ContextChip>,
      );
    }
    cursor = segment.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
