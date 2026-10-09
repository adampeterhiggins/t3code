import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  gitHubIssueContextRecord,
  isGitHubProject,
  threadsForGitHubIssue,
} from "@t3tools/client-runtime/state/github-issues";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitHubIssueStateFilter,
  GitHubIssueSummary,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProject, useThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { GitHubIcon } from "../Icons";
import { Badge } from "../ui/badge";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { toastManager } from "../ui/toast";
import {
  GITHUB_ISSUE_STATE_PRESENTATION,
  GitHubIssueHoverPreview,
} from "./GitHubIssueHoverPreview";
import { SourceTabs } from "./SourceTabs";

// Each search runs `gh` on the server, so typing settles before one goes out.
const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_ISSUES: ReadonlyArray<GitHubIssueSummary> = [];

const STATE_OPTIONS: ReadonlyArray<{ id: GitHubIssueStateFilter; label: string }> = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

type GitHubIssuePickerMode = "attach" | "link";

/**
 * The thread the picker serves, and whether it attaches an issue to the thread's composer or
 * links one to the thread's tab group. Set by whichever entry point asked (the attach menu, the
 * thread menu, the command palette) and rendered once by the app shell, so the picker outlives a
 * palette that closes the moment its command runs.
 */
const gitHubIssuePickerAtom = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: GitHubIssuePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("github-issues:issue-picker"));

export function openGitHubIssuePicker(
  threadRef: ScopedThreadRef,
  mode: GitHubIssuePickerMode = "attach",
): void {
  appAtomRegistry.set(gitHubIssuePickerAtom, { threadRef, mode });
}

function closeGitHubIssuePicker(): void {
  appAtomRegistry.set(gitHubIssuePickerAtom, null);
}

/**
 * Fetches an issue and drops its chip into the thread's composer. The issue is snapshotted now,
 * so the message keeps what the agent saw even if the issue changes later.
 */
export function useAttachGitHubIssue() {
  const getIssue = useAtomCommand(githubIssueEnvironment.getIssue, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, url: string): Promise<boolean> => {
      const result = await getIssue({ environmentId: threadRef.environmentId, input: { url } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not attach the GitHub issue",
            description: failure instanceof Error ? failure.message : undefined,
          });
        }
        return false;
      }
      const record = gitHubIssueContextRecord(result.value);
      useIssueContextStore.getState().upsert(threadRef.threadId, record);
      useComposerDraftStore.getState().insertContextReference(threadRef, {
        kind: "github-issue",
        contextId: record.contextId,
        label: record.label,
      });
      return true;
    },
    [getIssue],
  );
}

/** Links an issue to the thread's tab group, replacing the GitHub issue it had. */
export function useLinkGitHubIssue() {
  const linkThread = useAtomCommand(githubIssueEnvironment.linkThread, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, url: string): Promise<boolean> => {
      const result = await linkThread({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, url },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not link the GitHub issue",
            description: failure instanceof Error ? failure.message : undefined,
          });
        }
        return false;
      }
      return true;
    },
    [linkThread],
  );
}

/**
 * Issues in the repository `cwd` is checked out from, for the attach and start-from pickers. Pass
 * a null `cwd` to stop listing. A number, `#123`, or issue link in `query` is looked up directly
 * by the server; the last results stay on screen while the next query answers.
 */
export function useGitHubIssueList(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  query: string;
  state: GitHubIssueStateFilter;
}) {
  const trimmedQuery = input.query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const issuesQuery = useEnvironmentQuery(
    input.cwd === null
      ? null
      : githubIssueEnvironment.issues({
          environmentId: input.environmentId,
          input: {
            cwd: input.cwd,
            state: input.state,
            ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
          },
        }),
  );
  // A new query starts from an empty atom; keep the last results on screen until it answers.
  const [shownIssues, setShownIssues] = useState(EMPTY_ISSUES);
  const latestIssues = issuesQuery.data?.issues;
  if (latestIssues !== undefined && latestIssues !== shownIssues) setShownIssues(latestIssues);
  const issues = latestIssues ?? shownIssues;
  const searching = issuesQuery.isPending || trimmedQuery !== debouncedQuery;
  // `gh` failures (not installed, signed out, not a GitHub repository) read as the status line.
  const status =
    issues.length > 0
      ? null
      : searching
        ? "Searching GitHub issues…"
        : (issuesQuery.error ?? "No issues match.");
  return { issues, status };
}

/** The Open / Closed / All switch over a GitHub issue list. */
export function GitHubIssueStateTabs(props: {
  state: GitHubIssueStateFilter;
  onChange: (state: GitHubIssueStateFilter) => void;
}) {
  return (
    <SourceTabs
      options={STATE_OPTIONS}
      activeId={props.state}
      onSelect={props.onChange}
      className="flex gap-1 px-3 pb-2"
    />
  );
}

/** A GitHub issue list row. Fixed widths so authors and states line up down the list. */
export function GitHubIssueRow(props: { issue: GitHubIssueSummary; inUse: boolean }) {
  const { issue } = props;
  const state = GITHUB_ISSUE_STATE_PRESENTATION[issue.state];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-14 shrink-0 truncate text-muted-foreground text-xs tabular-nums">
        #{issue.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground text-sm">{issue.title}</span>
      {props.inUse ? (
        <Badge variant="outline" size="sm">
          In use
        </Badge>
      ) : null}
      <span className="w-24 shrink-0 truncate text-muted-foreground/70 text-xs">
        {issue.authorLogin ?? ""}
      </span>
      <span className={cn("w-14 shrink-0 truncate text-xs", state.toneClassName)}>
        {state.label}
      </span>
    </span>
  );
}

/**
 * Mounted once by the app shell, so the thread menu can open the picker from any route; shows it
 * for whichever thread or draft asked. Issues are listed with `gh` in that thread's own checkout,
 * or the project folder for a draft headed for a new worktree; any checkout answers the same.
 */
export function GitHubIssuePickerHost() {
  const target = useAtomValue(gitHubIssuePickerAtom);
  const threadRef = target?.threadRef ?? null;
  const thread = useThreadShell(threadRef);
  const draft = useComposerDraftStore((store) =>
    threadRef && !thread ? store.getDraftThreadByRef(threadRef) : null,
  );
  const owner = thread ? { projectId: thread.projectId, worktreePath: thread.worktreePath } : draft;
  const project = useProject(
    threadRef && owner ? scopeProjectRef(threadRef.environmentId, owner.projectId) : null,
  );
  if (target === null || owner === null || !project || !isGitHubProject(project)) return null;
  return (
    <GitHubIssuePickerDialog
      projectRef={scopeProjectRef(project.environmentId, project.id)}
      cwd={owner.worktreePath ?? project.workspaceRoot}
      threadRef={target.threadRef}
      mode={target.mode}
    />
  );
}

function GitHubIssuePickerDialog(props: {
  projectRef: ScopedProjectRef;
  cwd: string;
  threadRef: ScopedThreadRef;
  mode: GitHubIssuePickerMode;
}) {
  const { projectRef, cwd, threadRef, mode } = props;
  const environmentId = threadRef.environmentId;
  const navigate = useNavigate();
  const attachIssue = useAttachGitHubIssue();
  const linkIssue = useLinkGitHubIssue();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<GitHubIssueStateFilter>("open");
  const [attaching, setAttaching] = useState(false);
  const { issues, status } = useGitHubIssueList({ environmentId, cwd, query, state });
  // The host builds a fresh ref each render; key the list on its ids.
  const { projectId } = projectRef;
  const projectRefs = useMemo(
    () => [scopeProjectRef(environmentId, projectId)],
    [environmentId, projectId],
  );
  const threads = useThreadShellsForProjectRefs(projectRefs);
  const links = useEnvironmentQuery(
    githubIssueEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;

  async function select(issue: GitHubIssueSummary) {
    if (attaching) return;
    setAttaching(true);
    const done = await (mode === "link" ? linkIssue : attachIssue)(threadRef, issue.url);
    setAttaching(false);
    if (done) closeGitHubIssuePicker();
  }

  const openThread = (thread: EnvironmentThreadShell) => {
    closeGitHubIssuePicker();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closeGitHubIssuePicker();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link GitHub issue" : "Attach GitHub issue"}
        className="overflow-hidden"
      >
        <CommandPaletteContent
          inputProps={{
            placeholder: "Search GitHub issues, or paste #123 or an issue link",
            startAddon: <GitHubIcon />,
          }}
          footerActionLabel={
            mode === "link"
              ? attaching
                ? "Linking…"
                : "Link"
              : attaching
                ? "Attaching…"
                : "Attach"
          }
          inputAccessory={<GitHubIssueStateTabs state={state} onChange={setState} />}
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {status !== null ? (
            <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
          ) : (
            <CommandList>
              <CommandGroup items={[...issues]}>
                <CommandCollection>
                  {(issue: GitHubIssueSummary) => {
                    const inUse = threadsForGitHubIssue(threads, links, issue.url);
                    return (
                      <CommandItem
                        key={issue.url}
                        value={issue.url}
                        disabled={attaching}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void select(issue)}
                      >
                        <GitHubIssueHoverPreview
                          environmentId={environmentId}
                          url={issue.url}
                          threadRef={threadRef}
                          threads={inUse}
                          onOpenThread={openThread}
                          trigger={<GitHubIssueRow issue={issue} inUse={inUse.length > 0} />}
                        />
                      </CommandItem>
                    );
                  }}
                </CommandCollection>
              </CommandGroup>
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
