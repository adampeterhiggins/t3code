import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import {
  webToolView,
  webUrlParts,
  type WebToolView,
} from "@t3tools/client-runtime/work-log/web-tool";
import { ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { resolveExternalWebLinkHref } from "./externalLinkContextMenu";

// Longer answers start clamped so a hover card stays a glance.
const ANSWER_CLAMP_CHARS = 600;
const VISIBLE_RESULTS = 5;

function ExternalLink(props: {
  readonly url: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const href = props.url ? resolveExternalWebLinkHref(props.url) : null;
  if (!href) return <span className={props.className}>{props.children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("hover:underline", props.className)}
      onClick={(event) => event.stopPropagation()}
    >
      {props.children}
    </a>
  );
}

function StatusBadge({ code }: { readonly code: number }) {
  return (
    <Badge size="sm" variant={code >= 400 ? "error" : code >= 300 ? "warning" : "success"}>
      {code}
    </Badge>
  );
}

function UrlBreadcrumb({ url }: { readonly url: string }) {
  const parts = webUrlParts(url);
  return (
    <ExternalLink url={url} className="inline-flex min-w-0 items-baseline gap-1 text-foreground/85">
      <span className="min-w-0 break-words">
        {parts === undefined ? (
          url
        ) : (
          <>
            <span className="font-medium text-foreground">{parts.host}</span>
            {parts.segments.map((segment, index) => (
              // Segments repeat (`/docs/docs`), so position is the identity.
              // oxlint-disable-next-line react/no-array-index-key
              <span key={index} className="text-muted-foreground">
                {" › "}
                {segment}
              </span>
            ))}
          </>
        )}
      </span>
      <ExternalLinkIcon className="size-3 shrink-0 self-center text-muted-foreground" />
    </ExternalLink>
  );
}

function Answer(props: {
  readonly text: string;
  readonly cwd: string | undefined;
  readonly label: string;
}) {
  const clampable = props.text.length > ANSWER_CLAMP_CHARS;
  const [open, setOpen] = useState(false);
  const clamped = clampable && !open;
  return (
    <div className="space-y-1">
      <div
        className={cn(
          "select-text text-foreground/85",
          clamped &&
            "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
        )}
      >
        <ChatMarkdown text={props.text} cwd={props.cwd} parseRawHtml={false} />
      </div>
      {clampable ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? "Show less" : props.label}
        </button>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { readonly children: ReactNode }) {
  return (
    <div className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function FetchDetail(props: { readonly view: WebToolView; readonly cwd: string | undefined }) {
  const { view } = props;
  return (
    <div className="space-y-2.5">
      {view.url !== undefined || view.statusCode !== undefined ? (
        <div className="flex items-start justify-between gap-3">
          {view.url !== undefined ? <UrlBreadcrumb url={view.url} /> : <span />}
          {view.statusCode !== undefined ? <StatusBadge code={view.statusCode} /> : null}
        </div>
      ) : null}
      {view.prompt !== undefined ? (
        <div className="space-y-1">
          <SectionLabel>Asked</SectionLabel>
          <p className="select-text border-l-2 border-border ps-2.5 whitespace-pre-wrap text-muted-foreground italic">
            {view.prompt}
          </p>
        </div>
      ) : null}
      {view.answer !== undefined ? (
        <div className="space-y-1">
          {view.prompt !== undefined ? <SectionLabel>Answer</SectionLabel> : null}
          <Answer
            text={view.answer}
            cwd={props.cwd}
            label={view.prompt !== undefined ? "Show full answer" : "Show more"}
          />
        </div>
      ) : null}
      {view.results.length > 0 ? <ResultList view={view} /> : null}
    </div>
  );
}

function ResultList({ view }: { readonly view: WebToolView }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? view.results : view.results.slice(0, VISIBLE_RESULTS);
  const hidden = view.results.length - shown.length;
  return (
    <div>
      <ol className="divide-y divide-border/60">
        {shown.map((result, index) => {
          const host = result.url ? webUrlParts(result.url)?.host : undefined;
          return (
            // Hits are a ranked list that never reorders, and the same url can repeat.
            // oxlint-disable-next-line react/no-array-index-key
            <li key={index} className="flex gap-2 py-1.5">
              <span className="w-4 shrink-0 text-end text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <ExternalLink
                  url={result.url}
                  className="block truncate font-medium text-foreground"
                >
                  {result.title?.trim() || host || result.url || "Search result"}
                </ExternalLink>
                {host !== undefined ? (
                  <div className="truncate text-muted-foreground">{host}</div>
                ) : null}
                {result.snippet?.trim() ? (
                  <p className="line-clamp-2 select-text text-muted-foreground">
                    {result.snippet.trim()}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-1 text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setShowAll(true);
          }}
        >
          {hidden} more
        </button>
      ) : null}
    </div>
  );
}

function SearchDetail(props: { readonly view: WebToolView; readonly cwd: string | undefined }) {
  const { view } = props;
  return (
    <div className="space-y-2.5">
      {view.query !== undefined ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words font-medium text-foreground select-text">
            {view.query}
          </span>
          {view.results.length > 0 ? (
            <span className="shrink-0 text-muted-foreground">
              {view.results.length} {view.results.length === 1 ? "result" : "results"}
            </span>
          ) : null}
        </div>
      ) : null}
      {view.results.length > 0 ? <ResultList view={view} /> : null}
      {view.answer !== undefined ? (
        <Answer text={view.answer} cwd={props.cwd} label="Show more" />
      ) : null}
    </div>
  );
}

/** A fetch reads as question → answer; a search as its query and ranked results. */
export function WebToolDetail(props: {
  readonly item: Extract<OrchestrationV2TurnItem, { type: "web_search" }>;
  readonly cwd: string | undefined;
}) {
  const view = webToolView(props.item);
  return view.action === "fetch" ? (
    <FetchDetail view={view} cwd={props.cwd} />
  ) : (
    <SearchDetail view={view} cwd={props.cwd} />
  );
}
