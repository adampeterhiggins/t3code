import type {
  DevinReviewFinding,
  DevinReviewSeverity,
  DevinReviewStatus,
  DevinReviewSummary,
  DevinReviewWalkthroughSection,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** GraphQL reports the bot without REST's `[bot]` suffix. */
const DEVIN_REVIEW_BOT_LOGIN = "devin-ai-integration";

export const isDevinReviewAuthor = (login: string | null | undefined) =>
  login === DEVIN_REVIEW_BOT_LOGIN || login === `${DEVIN_REVIEW_BOT_LOGIN}[bot]`;

/** The first comment of a pull request review thread, as GitHub's GraphQL API returns it. */
export interface DevinReviewThreadComment {
  readonly body: string;
  readonly url: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly originalLine: number | null;
  readonly originalStartLine: number | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
}

const Marker = Schema.Struct({
  id: Schema.optional(Schema.String),
  file_path: Schema.optional(Schema.NullOr(Schema.String)),
  start_line: Schema.optional(Schema.NullOr(Schema.Int)),
  end_line: Schema.optional(Schema.NullOr(Schema.Int)),
  kind: Schema.optional(Schema.String),
});
const decodeMarker = Schema.decodeUnknownOption(Schema.fromJsonString(Marker));

const MARKER = /<!--\s*devin-review-comment\s+(\{[\s\S]*?\})\s*-->/u;
const BADGE = /<!--\s*devin-review-badge-begin\s*-->[\s\S]*?<!--\s*devin-review-badge-end\s*-->/gu;
const FEEDBACK_FOOTER = /\n-{3,}\s*\n\s*\*Was this helpful\?[^\n]*\*\s*$/u;
const DEVIN_LINK_LINE = /^\s*\*\[View in Devin Review\]\([^\n]*$/gmu;
const TITLE_LINE = /^\s*(\S*?)\s*\*\*(.+?)\*\*\s*$/u;

/** Devin marks severity with a coloured emoji before the title; anything else is informational. */
const SEVERITY_BY_EMOJI: ReadonlyArray<readonly [ReadonlyArray<string>, DevinReviewSeverity]> = [
  [["🔴", "🟥"], "high"],
  [["🟠", "🟧", "🟡", "🟨"], "medium"],
  [["🔵", "🟦", "🟢", "🟩", "⚪"], "low"],
];

export function devinReviewSeverity(prefix: string): DevinReviewSeverity {
  for (const [emojis, severity] of SEVERITY_BY_EMOJI) {
    if (emojis.some((emoji) => prefix.includes(emoji))) return severity;
  }
  return "info";
}

/** The finding a Devin Review comment describes, without its marker, title line, and badges. */
export function parseDevinReviewComment(comment: DevinReviewThreadComment): DevinReviewFinding {
  const markerMatch = MARKER.exec(comment.body);
  const marker = Option.getOrUndefined(decodeMarker(markerMatch?.[1] ?? ""));
  let rest = (markerMatch === null ? comment.body : comment.body.replace(MARKER, ""))
    .replace(BADGE, "")
    .replace(DEVIN_LINK_LINE, "")
    .replace(/\r\n/gu, "\n")
    .trim()
    .replace(FEEDBACK_FOOTER, "")
    .trim();

  const [firstLine = "", ...remaining] = rest.split("\n");
  const title = TITLE_LINE.exec(firstLine);
  let severity: DevinReviewSeverity = "info";
  let heading: string;
  if (title !== null) {
    severity = devinReviewSeverity(title[1] ?? "");
    heading = title[2]!.trim();
    rest = remaining.join("\n").trim();
  } else {
    heading = firstLine.replace(/^#+\s*/u, "").trim() || "Devin Review comment";
  }

  const endLine = marker?.end_line ?? comment.line ?? comment.originalLine ?? null;
  return {
    id: marker?.id ?? comment.url,
    kind: marker?.kind ?? "comment",
    severity,
    title: heading,
    body: rest,
    path: marker?.file_path ?? comment.path,
    startLine:
      marker?.start_line ?? comment.startLine ?? comment.originalStartLine ?? endLine ?? null,
    endLine,
    url: comment.url,
    resolved: comment.resolved,
    outdated: comment.outdated,
  };
}

export const isOpenFinding = (
  finding: Pick<DevinReviewFinding, "resolved" | "outdated" | "source" | "devinState">,
) =>
  !finding.resolved &&
  !finding.outdated &&
  // A finding only in Devin Review has no thread to resolve, so Devin's own state closes it.
  !(
    finding.source === "devin" &&
    (finding.devinState === "dismissed" || finding.devinState === "resolved")
  );

const SEVERITY_RANK: Record<DevinReviewSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const SEVERITY_LABEL: Record<DevinReviewSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const STATUS_LABEL: Record<DevinReviewStatus, string> = {
  pending: "queued",
  running: "running",
  completed: "completed",
  errored: "errored",
  cancelled: "cancelled",
  skipped: "skipped",
  none: "no review of the head commit",
  unknown: "unknown (Devin is not connected)",
};

function lineRange(finding: DevinReviewFinding): string {
  if (finding.endLine === null) return "";
  return finding.startLine === null || finding.startLine === finding.endLine
    ? `:${finding.endLine}`
    : `:${finding.startLine}-${finding.endLine}`;
}

const location = (finding: DevinReviewFinding) =>
  finding.path === null ? "(no file)" : `${finding.path}${lineRange(finding)}`;

/** Files ordered by their most severe open finding, each file's findings by line. */
function groupByFile(findings: ReadonlyArray<DevinReviewFinding>) {
  const groups = new Map<string, Array<DevinReviewFinding>>();
  for (const finding of findings) {
    const key = finding.path ?? "";
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const worst = (items: ReadonlyArray<DevinReviewFinding>) =>
    Math.min(...items.map((item) => SEVERITY_RANK[item.severity]));
  return [...groups.entries()]
    .map(
      ([path, items]) =>
        [
          path,
          items.toSorted(
            (a, b) =>
              (a.startLine ?? 0) - (b.startLine ?? 0) ||
              SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
          ),
        ] as const,
    )
    .toSorted(([, a], [, b]) => worst(a) - worst(b));
}

/** The walkthrough explains the change; findings matter more, so it gets a fixed share. */
const WALKTHROUGH_MAX_CHARS = 12_000;
const WALKTHROUGH_SECTION_MAX_CHARS = 3_000;
const FIX_PROMPT_MAX_CHARS = 4_000;

const cap = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function renderWalkthrough(walkthrough: ReadonlyArray<DevinReviewWalkthroughSection>): string {
  let text = "";
  for (const section of walkthrough) {
    const body = cap(section.text.trim(), WALKTHROUGH_SECTION_MAX_CHARS);
    const next = `\n\n### ${section.title}${body.length > 0 ? `\n\n${body}` : ""}`;
    if (text.length + next.length > WALKTHROUGH_MAX_CHARS) break;
    text += next;
  }
  return text.length === 0 ? "" : `\n\n## Walkthrough${text}`;
}

function renderFindingDetails(finding: DevinReviewFinding): string {
  const parts: Array<string> = [];
  if (finding.devinState === "dismissed" || finding.devinState === "resolved") {
    parts.push(
      `\n\nDevin marks this ${finding.devinState}${finding.resolutionReason ? `: ${finding.resolutionReason}` : "."}`,
    );
  }
  if (finding.impactSummary) parts.push(`\n\n**Impact:** ${finding.impactSummary}`);
  if (finding.suggestedFixPrompt) {
    parts.push(
      `\n\n**Suggested fix (Devin's prompt for a coding agent):**\n\n${cap(finding.suggestedFixPrompt.trim(), FIX_PROMPT_MAX_CHARS)}`,
    );
  }
  return parts.join("");
}

const heading = (finding: DevinReviewFinding) =>
  `${SEVERITY_LABEL[finding.severity]} · ${finding.kind === "security" ? "Security · " : ""}${finding.title}`;

function whereToAct(finding: DevinReviewFinding, reviewUrl: string): string {
  if (finding.source === "devin") {
    return `\nDevin only, not posted to GitHub, so there is no thread to resolve: ${finding.url}`;
  }
  const thread = finding.threadId ? ` (thread ${finding.threadId})` : "";
  return `\nGitHub thread${thread}: ${finding.url}\nDevin Review: ${reviewUrl}`;
}

function closedState(finding: DevinReviewFinding): string {
  if (finding.resolved) return "resolved";
  if (finding.outdated) return "outdated";
  return finding.devinState === "dismissed" ? "dismissed by Devin" : "resolved by Devin";
}

export function renderDevinReviewMarkdown(
  summary: DevinReviewSummary,
  findings: ReadonlyArray<DevinReviewFinding>,
  maxChars: number,
  options: {
    readonly walkthrough?: ReadonlyArray<DevinReviewWalkthroughSection> | null;
    /** Why findings were read from GitHub alone, which misses those Devin did not post there. */
    readonly githubOnlyReason?: string | null;
  } = {},
): string {
  const walkthrough = options.walkthrough ?? null;
  const open = findings.filter(isOpenFinding);
  const closed = findings.filter((finding) => !isOpenFinding(finding));
  const openSecurity = open.filter((finding) => finding.kind === "security").length;
  const status = [
    `Status: ${STATUS_LABEL[summary.status]}`,
    summary.commitSha === null ? null : `commit ${summary.commitSha.slice(0, 12)}`,
    summary.statusAt,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const header = [
    `# Devin Review · ${summary.repository}#${summary.number}: ${summary.title}`,
    "",
    status,
    `Devin Review: ${summary.reviewUrl}`,
    `Pull request: ${summary.pullRequestUrl}`,
    `${open.length} open ${open.length === 1 ? "finding" : "findings"}${openSecurity > 0 ? ` (${openSecurity} security)` : ""}, ${closed.length} resolved or outdated.`,
    options.githubOnlyReason == null
      ? null
      : `Findings were read from GitHub's review comments alone (${options.githubOnlyReason}). Security findings Devin did not post to GitHub may be missing; check Devin Review.`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const sections: Array<{ readonly text: string; readonly findings: number }> = [];
  const walkthroughText = walkthrough === null ? "" : renderWalkthrough(walkthrough);
  if (walkthroughText.length > 0) sections.push({ text: walkthroughText, findings: 0 });
  if (open.length > 0) sections.push({ text: "\n\n## Open findings", findings: 0 });
  for (const [path, items] of groupByFile(open)) {
    sections.push({ text: `\n\n### ${path === "" ? "(no file)" : path}`, findings: 0 });
    for (const finding of items) {
      const lines = [
        `\n\n#### ${heading(finding)}`,
        `\n${location(finding)} · ${finding.kind}`,
        whereToAct(finding, summary.reviewUrl),
        finding.body.length > 0 ? `\n\n${finding.body}` : "",
        renderFindingDetails(finding),
      ];
      sections.push({ text: lines.join(""), findings: 1 });
    }
  }
  if (closed.length > 0) {
    sections.push({ text: "\n\n## Resolved or outdated", findings: 0 });
    for (const finding of closed) {
      sections.push({
        text: `\n- [${closedState(finding)}] ${heading(finding)} · ${location(finding)}`,
        findings: 1,
      });
    }
  }

  // Reserve room for the note that says how many findings were left out.
  const budget = maxChars - 160;
  let markdown = header;
  let shown = 0;
  for (const section of sections) {
    if (markdown.length + section.text.length > budget) break;
    markdown += section.text;
    shown += section.findings;
  }
  const omitted = findings.length - shown;
  if (omitted > 0) {
    markdown += `\n\n… ${omitted} more ${omitted === 1 ? "finding" : "findings"} not shown. Read them on the pull request.`;
  }
  return markdown.slice(0, maxChars);
}
