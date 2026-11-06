import type { AssistantCitation } from "@t3tools/contracts";
import {
  assistantCitationLabel,
  collectAssistantCitations,
} from "@t3tools/shared/assistantCitations";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
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
  CpuIcon,
  QuoteIcon,
  TerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useTheme } from "../../hooks/useTheme";
import { basenameOfPath } from "../../pierre-icons";
import { ContextChip, ContextChipLabel, type ContextChipKind } from "../ContextChip";
import {
  GitHubIcon,
  DiscordIcon,
  GranolaIcon,
  LinearIcon,
  NotionIcon,
  GoogleIcon,
  SlackIcon,
} from "../Icons";
import { FileTagChipContent } from "./FileTagChip";
import { SkillChipIcon } from "./SkillChipIcon";

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
  "linear-object": <LinearIcon />,
  "github-issue": <GitHubIcon />,
  "github-ref": <GitHubIcon />,
  "slack-thread": <SlackIcon />,
  "slack-resource": <SlackIcon />,
  "discord-thread": <DiscordIcon />,
  "notion-page": <NotionIcon />,
  "google-file": <GoogleIcon />,
  "granola-note": <GranolaIcon />,
  repository: <FolderGit2Icon />,
  checkout: <FolderIcon />,
  citation: <QuoteIcon />,
  model: <CpuIcon />,
};

type Segment = {
  start: number;
  end: number;
  kind: ContextChipKind;
  label: string;
  path?: string;
  citation?: AssistantCitation;
};

/**
 * One-line message text with references, mentions and quotes drawn as static label chips, for
 * previews with no records to open (draft rows). Chips have no hover previews: callers make
 * the whole line a tooltip trigger, where a chip's own preview could not be reached.
 */
export function InlineChipText({
  text,
  hideImages,
  expandCitations,
}: {
  text: string;
  hideImages?: boolean;
  expandCitations?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const segments: Segment[] = [
    // Mentions only match before whitespace; the pad lets one end the text.
    ...collectComposerInlineTokens(`${text} `)
      .filter((token) => token.type === "mention")
      .map((token) => ({
        start: token.start,
        end: token.end,
        kind: "mention" as const,
        label: basenameOfPath(token.value),
        path: token.value,
      })),
    ...collectComposerContextReferences(text).map((reference) => ({
      start: reference.start,
      end: reference.end,
      kind: contextChipKind(reference.kind),
      label: hideImages && reference.kind === "image" ? "" : reference.label,
    })),
    ...collectAssistantCitations(text).map((match) => ({
      start: match.start,
      end: match.end,
      kind: "citation" as const,
      label: assistantCitationLabel(match.citation),
      citation: match.citation,
    })),
  ].toSorted((a, b) => a.start - b.start);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor) continue;
    parts.push(text.slice(cursor, segment.start));
    if (expandCitations && segment.citation) {
      parts.push(
        <span key={segment.start} className="my-1 block">
          <span className="line-clamp-6 block border-l-2 border-border pl-2 whitespace-pre-wrap text-muted-foreground">
            {segment.citation.text}
          </span>
          {segment.citation.comment ? (
            <span className="mt-1 block whitespace-pre-wrap">{segment.citation.comment}</span>
          ) : null}
        </span>,
      );
    } else if (segment.label && segment.path !== undefined) {
      parts.push(
        <ContextChip key={segment.start} kind={segment.kind}>
          <FileTagChipContent path={segment.path} label={segment.label} theme={resolvedTheme} />
        </ContextChip>,
      );
    } else if (segment.label) {
      parts.push(
        <StaticContextChip key={segment.start} kind={segment.kind} label={segment.label} />,
      );
    }
    cursor = segment.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function contextChipKind(kind: string): ContextChipKind {
  return kind in CHIP_ICONS ? (kind as ContextChipKind) : "neutral";
}

/** A reference's label chip with no record behind it, for text whose context is not resolved. */
export function StaticContextChip(props: { kind: string; label: string }) {
  const kind = contextChipKind(props.kind);
  return (
    <ContextChip kind={kind}>
      {CHIP_ICONS[kind]}
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </ContextChip>
  );
}
