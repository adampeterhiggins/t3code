import { ToolPathText } from "./ToolPathText";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { formatPathsForWorkspace } from "@t3tools/client-runtime/work-log/command-display";
import {
  fileChangeDiffWithheld,
  fileChangePreviewText,
  toolCallLines,
  turnItemDetailRevision,
  turnItemNeedsDetailFetch,
  turnItemOutputImages,
  turnItemOutputText,
  turnItemReadFile,
} from "@t3tools/client-runtime/work-log/item-detail";
import { resolveToolPreview } from "@t3tools/client-runtime/work-log/tool-preview";
import { ExternalLinkIcon, GitBranchIcon, RotateCcwIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "../../lib/utils";
import { useTurnItemDetail } from "../../state/queries";
import { useV2ItemSupport } from "../../state/v2ItemSupport";
import { Button } from "../ui/button";
import ChatMarkdown, { ChatMarkdownAssetImage } from "../ChatMarkdown";
import { ToolCallBody as ToolPreviewBody } from "../ToolCallBody";
import { resolveExternalWebLinkHref } from "./externalLinkContextMenu";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { ReadFileView } from "./ReadFileView";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { ShellCommandBlock } from "./ShellCommandBlock";
import { parseJsonDocument, ToolJsonTree } from "./ToolJsonTree";
import { ToolPreviewCard } from "./ToolPreviewCard";

interface V2ItemInspectorProps {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly environmentId: EnvironmentId;
  readonly cwd?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  /** Omit a command's text when the surrounding surface already shows it, as the hover preview does. */
  readonly hideCommand?: boolean | undefined;
  /** Hover previews opt in; expanded chat rows keep commands and arguments plain. */
  readonly highlightSyntax?: boolean | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  readonly onRollbackCheckpoint?: (input: {
    readonly checkpointId: string;
    readonly scopeId: string;
  }) => void;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}

const monoClassName =
  "font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

function StructuredValue({
  value,
  highlightJson = false,
}: {
  readonly value: unknown;
  readonly highlightJson?: boolean;
}) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const isJson = useMemo(() => {
    if (!highlightJson || !text) return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }, [highlightJson, text]);
  if (!text) return null;
  return (
    <pre className={cn("max-h-80 overflow-auto text-muted-foreground", monoClassName)}>
      {isJson ? <HighlightedSnippet text={text} lang="json" /> : text}
    </pre>
  );
}

/**
 * The item behind a projected row, with the output the timeline withheld
 * fetched while the row is open.
 */
function useFetchedTurnItem(
  projectedItem: OrchestrationV2ProjectedTurnItem,
  environmentId: EnvironmentId,
) {
  const wireItem = projectedItem.item;
  // Fork: an open edit also fetches the diff the timeline left out, for its preview.
  const fetches = turnItemNeedsDetailFetch(wireItem) || fileChangeDiffWithheld(wireItem);
  const detail = useTurnItemDetail(
    fetches
      ? {
          environmentId,
          threadId: projectedItem.sourceThreadId,
          itemId: projectedItem.sourceItemId,
          revision: turnItemDetailRevision(wireItem),
        }
      : null,
  );
  const fetchedItem = detail.data?.item;
  const item = fetchedItem?.type === wireItem.type ? fetchedItem : wireItem;
  return {
    item,
    output: {
      output: turnItemOutputText(item),
      readFile: turnItemReadFile(item),
      images: turnItemOutputImages(item),
      environmentId,
      pending: item === wireItem && detail.isPending,
      error:
        item !== wireItem
          ? null
          : detail.data?.item === null
            ? "Output is no longer available."
            : detail.error,
      empty: fetches && item !== wireItem,
    },
  };
}

interface ToolOutputState {
  readonly output: string | null;
  /** Fork: a file read's contents, shown as source instead of `output`. */
  readonly readFile?: ReturnType<typeof turnItemReadFile> | undefined;
  readonly images: ReturnType<typeof turnItemOutputImages>;
  readonly environmentId: EnvironmentId;
  readonly pending: boolean;
  readonly error: string | null;
  readonly empty: boolean;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  /** Anchors links in markdown output. */
  readonly cwd?: string | undefined;
}

function ToolOutputImages(
  props: Pick<ToolOutputState, "images" | "environmentId" | "onImageExpand">,
) {
  return props.images.map((resource) => (
    <ChatMarkdownAssetImage
      key={resource.index}
      environmentId={props.environmentId}
      resource={resource}
      alt="Tool output image"
      maxHeightRem={16}
      onImageExpand={props.onImageExpand}
    />
  ));
}

// Markdown results (search results, fetched pages) open with a heading.
const MARKDOWN_HEADING = /^#{1,6} \S/;

/**
 * Tool output text. A structured tool's JSON shows as a tree and its markdown rendered;
 * a command's output stays the text the terminal printed.
 */
function ToolOutputText(props: {
  readonly text: string;
  readonly cwd: string | undefined;
  readonly structured: boolean;
}) {
  const { text, cwd, structured } = props;
  const json = useMemo(() => (structured ? parseJsonDocument(text) : null), [structured, text]);
  if (json) return <ToolJsonTree value={json} />;
  if (structured && MARKDOWN_HEADING.test(text.trimStart())) {
    return (
      <div className="max-h-80 overflow-auto font-sans whitespace-normal text-foreground/85">
        <ChatMarkdown text={text} cwd={cwd} />
      </div>
    );
  }
  return <div className="max-h-80 overflow-auto text-muted-foreground">{text}</div>;
}

function ToolOutput(props: ToolOutputState & { readonly structured?: boolean }) {
  const images = <ToolOutputImages {...props} />;
  const text = props.readFile ? (
    <ReadFileView file={props.readFile} className="max-h-80" />
  ) : props.output ? (
    <ToolOutputText text={props.output} cwd={props.cwd} structured={props.structured ?? false} />
  ) : props.pending ? (
    <div className="text-muted-foreground italic">Loading output…</div>
  ) : props.error ? (
    <div className="text-destructive">Couldn&apos;t load output: {props.error}</div>
  ) : props.empty && props.images.length === 0 ? (
    <div className="text-muted-foreground italic">No output.</div>
  ) : null;
  return (
    <>
      {images}
      {text}
    </>
  );
}

/** Fetched output for rows that show their own plain text instead of the inspector. */
export function FetchedToolOutput(props: {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly environmentId: EnvironmentId;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}) {
  const { output } = useFetchedTurnItem(props.projectedItem, props.environmentId);
  return (
    <div className={cn("mt-1.5 space-y-1.5", monoClassName)}>
      <ToolOutput {...output} onImageExpand={props.onImageExpand} />
    </div>
  );
}

/** A tool call's body: the call itself in the foreground, its result muted below. */
function ToolCallBody(
  props: ToolOutputState & {
    readonly command?: string;
    readonly args?: unknown;
    readonly exitCode?: number | undefined;
    readonly highlightSyntax?: boolean | undefined;
  },
) {
  const call = toolCallLines({ command: props.command, args: props.args });
  return (
    <div className={cn("space-y-1.5", monoClassName)}>
      {call.command ? (
        <ShellCommandBlock command={call.command} highlightSyntax={props.highlightSyntax} />
      ) : null}
      {call.args ? (
        <div className="text-foreground/85">
          {call.args.map(([key, value]) => (
            <div key={key}>
              <span className="text-muted-foreground">{key} </span>
              {value}
            </div>
          ))}
        </div>
      ) : null}
      {call.argsText ? (
        <StructuredValue value={call.argsText} highlightJson={props.highlightSyntax ?? false} />
      ) : null}
      <ToolOutput {...props} structured={props.command === undefined} />
      {props.exitCode !== undefined ? (
        <div className={props.exitCode === 0 ? "text-muted-foreground" : "text-destructive"}>
          exit {props.exitCode}
        </div>
      ) : null}
    </div>
  );
}

/** Fork: an edit's bounded unified diff, once the stored item has been fetched. */
function FileChangePreview(props: {
  readonly preview: string | null;
  readonly pending: boolean;
  readonly workspaceRoot: string | undefined;
}) {
  if (props.preview === null) {
    return props.pending ? <div className="text-muted-foreground italic">Loading diff…</div> : null;
  }
  // Line counts already sit beside the file name; the preview adds the diff.
  const diff = props.preview
    .split("\n\n")
    .filter((block) => !/^\+\d+, −\d+ lines$/.test(block))
    .join("\n\n");
  return diff ? (
    <ToolPreviewBody
      className="max-h-80 text-muted-foreground"
      text={formatPathsForWorkspace(diff, props.workspaceRoot)}
    />
  ) : null;
}

export const V2ItemInspector = memo(function V2ItemInspector(props: V2ItemInspectorProps) {
  const fetched = useFetchedTurnItem(props.projectedItem, props.environmentId);
  const item = fetched.item;
  const outputState = fetched.output;
  const preview = useMemo(() => resolveToolPreview(item), [item]);
  const support = useV2ItemSupport({
    environmentId: props.environmentId,
    sourceThreadId: props.projectedItem.sourceThreadId,
    sourceItemId: props.projectedItem.sourceItemId,
  });
  return (
    <div className="space-y-2 text-xs" data-v2-item-inspector={item.type}>
      {item.type === "reasoning" && item.text ? (
        <div className="rounded-md border border-border/45 bg-muted/15 p-2 italic text-muted-foreground">
          <ChatMarkdown
            text={item.text}
            cwd={props.cwd}
            threadRef={{
              environmentId: props.environmentId,
              threadId: props.projectedItem.sourceThreadId,
            }}
            lineBreaks
          />
        </div>
      ) : null}

      {item.type === "command_execution" ? (
        <ToolCallBody
          command={props.hideCommand ? "" : item.input}
          highlightSyntax={props.highlightSyntax}
          exitCode={item.exitCode}
          {...outputState}
          onImageExpand={props.onImageExpand}
        />
      ) : null}

      {item.type === "file_change" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted-foreground">
              <ToolPathText
                text={item.fileName}
                environmentId={props.environmentId}
                workspaceRoot={props.workspaceRoot}
                pathOnly
              />
            </span>
            {item.additions !== undefined || item.deletions !== undefined ? (
              <span>
                <span className="text-success">+{item.additions ?? 0}</span>{" "}
                <span className="text-destructive">-{item.deletions ?? 0}</span>
              </span>
            ) : null}
            {item.runId !== null ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => props.onOpenTurnDiff(item.runId!, item.fileName)}
              >
                Open diff
              </Button>
            ) : null}
          </div>
          {item.status === "failed" && item.diffStr?.trim() ? (
            <StructuredValue value={item.diffStr} />
          ) : null}
          <FileChangePreview
            preview={fileChangePreviewText(item)}
            pending={outputState.pending}
            workspaceRoot={props.workspaceRoot}
          />
          {item.changes !== undefined && item.changes.length > 0 ? (
            <ul className="space-y-1 font-mono text-muted-foreground">
              {item.changes.map((change, index) => (
                <li key={`${change.operation}:${change.path}:${index}`}>
                  {change.operation} {change.oldPath ? `${change.oldPath} → ` : ""}
                  <ToolPathText
                    text={change.path}
                    environmentId={props.environmentId}
                    workspaceRoot={props.workspaceRoot}
                    pathOnly
                  />
                  {change.fileType || change.mimeType
                    ? ` (${[change.fileType, change.mimeType].filter(Boolean).join(", ")})`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {item.type === "file_search" && item.pattern?.trim() ? (
        <div className={cn("text-foreground/85", monoClassName)}>{item.pattern}</div>
      ) : null}

      {item.type === "web_search" && item.patterns?.length ? (
        <div className={cn("text-foreground/85", monoClassName)}>{item.patterns.join("\n")}</div>
      ) : null}

      {item.type === "file_search" && item.results?.length ? (
        <ul className="space-y-1">
          {item.results.map((result) => (
            <li key={JSON.stringify(result)}>
              <span className="font-mono text-foreground/80">
                <ToolPathText
                  text={result.fileName}
                  environmentId={props.environmentId}
                  workspaceRoot={props.workspaceRoot}
                  pathOnly
                />
                {result.line === undefined ? "" : `:${result.line}`}
                {result.column === undefined ? "" : `:${result.column}`}
              </span>
              {result.preview ? (
                <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{result.preview}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {item.type === "web_search" && item.results?.length ? (
        <ul className="space-y-1.5">
          {item.results.map((result) => {
            const safeHref = resolveExternalWebLinkHref(result.url);
            return (
              <li key={JSON.stringify(result)}>
                {safeHref ? (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                  >
                    {result.title ?? result.url}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  <p className="font-medium text-foreground">
                    {result.title ?? result.url ?? "Search result"}
                  </p>
                )}
                {result.snippet ? <p className="text-muted-foreground">{result.snippet}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {item.type === "dynamic_tool" ? (
        preview ? (
          <ToolPreviewCard
            preview={preview}
            environmentId={props.environmentId}
            threadId={props.projectedItem.sourceThreadId}
            cwd={props.cwd}
            onOpenThread={props.onOpenThread}
            images={<ToolOutputImages {...outputState} onImageExpand={props.onImageExpand} />}
            raw={
              <ToolCallBody
                args={item.input}
                highlightSyntax={props.highlightSyntax}
                {...outputState}
                images={[]}
                cwd={props.cwd}
              />
            }
          />
        ) : (
          <ToolCallBody
            args={item.input}
            highlightSyntax={props.highlightSyntax}
            {...outputState}
            cwd={props.cwd}
            onImageExpand={props.onImageExpand}
          />
        )
      ) : null}

      {item.type === "approval_request" ? <StructuredValue value={item.prompt} /> : null}
      {item.type === "user_input_request" ? (
        <StructuredValue value={item.questions.map((question) => question.question).join("\n\n")} />
      ) : null}
      {item.type === "notification" ? <StructuredValue value={item.detail} /> : null}
      {item.type === "system_notice" ? <StructuredValue value={item.message} /> : null}
      {item.type === "error" ? <StructuredValue value={item.failure.message} /> : null}
      {item.type === "proposed_plan" ? <StructuredValue value={item.markdown} /> : null}
      {item.type === "todo_list" ? (
        <StructuredValue
          value={item.steps
            .map((step) => `${step.status === "completed" ? "✓" : "○"} ${step.text}`)
            .join("\n")}
        />
      ) : null}

      {item.type === "checkpoint" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {support.checkpoint?.status ?? item.status} · {item.files.length} files
          </span>
          {props.onRollbackCheckpoint && support.checkpoint?.status === "ready" ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                props.onRollbackCheckpoint?.({
                  checkpointId: item.checkpointId,
                  scopeId: item.scopeId,
                })
              }
            >
              <RotateCcwIcon className="size-3" />
              Roll back
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.type === "fork" ? (
        <Button size="xs" variant="outline" onClick={() => props.onOpenThread(item.targetThreadId)}>
          <GitBranchIcon className="size-3" />
          Open fork
        </Button>
      ) : null}

      {item.type === "subagent" && item.childThreadId !== null ? (
        <Button size="xs" variant="outline" onClick={() => props.onOpenThread(item.childThreadId!)}>
          Open subagent thread
        </Button>
      ) : null}

      {item.type === "handoff" ? (
        <div className="space-y-1 text-muted-foreground">
          <p>
            {item.fromProviderInstanceIds.join(", ")} → {item.toProviderInstanceId}
          </p>
          <p>
            {item.strategy.replaceAll("_", " ")} · {support.contextHandoff?.status ?? item.status}
          </p>
          {support.contextTransfer ? (
            <p>
              Transfer {support.contextTransfer.type.replaceAll("_", " ")} ·{" "}
              {support.contextTransfer.status}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
