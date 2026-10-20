import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadsForGitHubIssue } from "@t3tools/client-runtime/state/github-issues";
import { threadsForLinearIssue } from "@t3tools/client-runtime/state/linear";
import { threadsForPullRequest } from "@t3tools/client-runtime/state/pull-requests";
import {
  automationRunBlocker,
  automationsForPicker,
} from "@t3tools/client-runtime/scheduled-task-picker";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  DesktopQuickMessageStartFrom,
  EnvironmentId,
  GitHubIssueStateFilter,
  GitHubIssueSummary,
  LinearIssueSummary,
  ProjectId,
  ScheduledTask,
  ScopedProjectRef,
  ScopedThreadRef,
  VcsRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { CalendarClockIcon, CalendarPlusIcon, GitBranchIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

import { useRunScheduledTask } from "~/hooks/useRunThreadScheduledTask";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { usePreparePullRequestThreadAction } from "~/lib/sourceControlActions";
import { cn, isMacPlatform } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { linearEnvironment } from "~/state/linear";
import { usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue, usePaginatedBranches } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { buildThreadRouteParams } from "~/threadRoutes";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { LinearIcon } from "../Icons";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
import { setPendingScheduledTaskDraft } from "../settings/scheduledTaskDraftSeed";
import {
  type ComposerAutomationSource,
  scheduledTaskSeedFromComposer,
} from "../settings/scheduledTasksSettings.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Kbd, KbdGroup } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { scheduleLabel } from "../settings/ScheduledTasksSettings";
import { GitHubIssueHoverPreview } from "./GitHubIssueHoverPreview";
import {
  GitHubIssueRow,
  GitHubIssueStateTabs,
  useAttachGitHubIssue,
  useGitHubIssueList,
  useLinkGitHubIssue,
} from "./GitHubIssuePicker";
import { useGitHubIssueThreadLinks } from "./GitHubIssueThreadLink";
import { LinearIssueHoverPreview } from "./LinearIssueHoverPreview";
import {
  LinearIssueFilterBar,
  useLinearIssuePickerView,
  useLinearIssuePickerViewStore,
} from "./LinearIssueFilters";
import { useAttachLinearIssue, useLinkLinearIssue } from "./LinearIssuePicker";
import { useLinearThreadLinks } from "./LinearThreadLink";
import { localBranchName, resolveBranchStart, threadsForBranch } from "./StartFromPicker.logic";
import { SourceTabs } from "./SourceTabs";
import {
  DEFAULT_PULL_REQUEST_PICKER_VIEW,
  narrowPickerPullRequests,
  PullRequestPickerFilterBar,
} from "./StartFromPullRequestFilters";
import {
  AutomationHoverPreview,
  BranchHoverPreview,
  PullRequestHoverPreview,
} from "./StartFromPreviews";

type StartFromTab = "pull-requests" | "branches" | "issues" | "linear" | "automations";
const ALL_TABS: ReadonlyArray<{ id: StartFromTab; label: string }> = [
  { id: "pull-requests", label: "PRs" },
  { id: "branches", label: "Branches" },
  { id: "issues", label: "Issues" },
  { id: "linear", label: "Linear" },
  { id: "automations", label: "Automations" },
];
// Without GitHub, the project has no issues tab of its own.
const TABS_WITHOUT_GITHUB_ISSUES = ALL_TABS.filter((entry) => entry.id !== "issues");
const PLACEHOLDERS: Record<StartFromTab, string> = {
  "pull-requests": "Search pull requests by title, number, or author",
  branches: "Search branches",
  issues: "Search GitHub issues, or paste #123 or an issue link",
  linear: "Search Linear issues, or paste ENG-123 or an issue link",
  automations: "Search automations by name or prompt",
};
const NEW_AUTOMATION_VALUE = "automation:new";
const NEW_AUTOMATION_ITEMS = [NEW_AUTOMATION_VALUE];
const EMPTY_TASKS: ReadonlyArray<ScheduledTask> = [];
const SEARCH_DEBOUNCE_MS = 300;
const PULL_REQUEST_LIMIT = 50;
const EMPTY_ISSUES: ReadonlyArray<LinearIssueSummary> = [];
const EMPTY_PULL_REQUESTS: ReadonlyArray<EnvironmentPullRequestEntry> = [];

/**
 * Whether the draft composer's "start from" picker is open. Set by the composer's ⋯ button, the
 * command palette and the `chat.startFrom` shortcut, and rendered once by the draft's chat view.
 */
const startFromPickerOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:start-from-picker-open"),
);

export function openStartFromPicker(): void {
  appAtomRegistry.set(startFromPickerOpenAtom, true);
}

function closeStartFromPicker(): void {
  appAtomRegistry.set(startFromPickerOpenAtom, false);
}

interface StartFromPickerHostProps {
  readonly environmentId: EnvironmentId;
  readonly projectRef: ScopedProjectRef;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  /** Whether the project is a GitHub repository, whose issues get their own tab. */
  readonly githubIssuesAvailable: boolean;
  /** The draft's thread, which a picked issue is attached and linked to. */
  readonly threadRef: ScopedThreadRef;
  /** Point the draft at a checkout: a picked branch's, or a picked pull request's. */
  readonly onCheckout: (checkout: ReturnType<typeof resolveBranchStart>) => void;
  /** What the draft's composer holds, read when a new automation is started from it. */
  readonly readAutomationSource: () => ComposerAutomationSource | null;
}

/** Mounted by a local draft's chat view; shows the picker while it is open. */
export function StartFromPickerHost(props: StartFromPickerHostProps) {
  const { environmentId, threadRef } = props;
  const open = useAtomValue(startFromPickerOpenAtom);
  const navigate = useNavigate();
  const applyPick = useApplyStartFrom(props);

  if (!open) return null;
  return (
    <StartFromPickerDialog
      environmentId={environmentId}
      projectRef={props.projectRef}
      projectId={props.projectId}
      workspaceRoot={props.workspaceRoot}
      githubIssuesAvailable={props.githubIssuesAvailable}
      linkThreadRef={threadRef}
      onPick={applyPick}
      onOpen={(href) => void navigate({ href })}
      onNewAutomation={() => {
        const source = props.readAutomationSource();
        if (source === null) return false;
        setPendingScheduledTaskDraft({
          environmentId,
          seed: scheduledTaskSeedFromComposer(source),
        });
        void navigate({ to: "/settings/scheduled-tasks", search: { environmentId } });
        return true;
      }}
      onClose={closeStartFromPicker}
    />
  );
}

/**
 * Points a draft at a pick: checks a pull request out in its own worktree, or reuses the one it
 * is already checked out in; works on a branch where `resolveBranchStart` says; attaches and
 * links an issue. Resolves whether the pick took.
 */
export function useApplyStartFrom(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly threadRef: ScopedThreadRef;
  readonly onCheckout: (checkout: ReturnType<typeof resolveBranchStart>) => void;
}) {
  const { environmentId, workspaceRoot, threadRef, onCheckout } = props;
  const preparePullRequestCheckout = usePreparePullRequestThreadAction({
    environmentId,
    cwd: workspaceRoot,
  });
  const attachIssue = useAttachLinearIssue();
  const linkIssue = useLinkLinearIssue();
  const attachGitHubIssue = useAttachGitHubIssue();
  const linkGitHubIssue = useLinkGitHubIssue();

  return async (pick: DesktopQuickMessageStartFrom): Promise<boolean> => {
    switch (pick.type) {
      case "branch":
        onCheckout({ branch: pick.branch, worktreePath: pick.worktreePath, envMode: pick.envMode });
        return true;
      case "linear-issue": {
        const attached = await attachIssue(threadRef, pick.issueId);
        if (attached) await linkIssue(threadRef, pick.issueId);
        return attached;
      }
      case "github-issue": {
        const attached = await attachGitHubIssue(threadRef, pick.url);
        if (attached) await linkGitHubIssue(threadRef, pick.url);
        return attached;
      }
      case "pull-request": {
        const result = await preparePullRequestCheckout.run({
          reference: pick.url,
          mode: "worktree",
          // The project's setup script runs in a new worktree for the thread it is made for.
          threadId: threadRef.threadId,
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const failure = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: `Could not check out #${pick.number}`,
              description: failure instanceof Error ? failure.message : undefined,
            });
          }
          preparePullRequestCheckout.resetError();
          return false;
        }
        onCheckout({
          branch: result.value.branch,
          worktreePath: result.value.worktreePath,
          envMode: "worktree",
        });
        if (!result.value.isOnPullRequestHead) {
          toastManager.add({
            type: "warning",
            title: "Checked out, but not on the latest commits",
            description:
              "The worktree holds uncommitted work or local commits, so it stays behind the pull request.",
          });
        }
        return true;
      }
    }
  };
}

interface StartFromPickerDialogProps {
  readonly environmentId: EnvironmentId;
  readonly projectRef: ScopedProjectRef;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly githubIssuesAvailable: boolean;
  /** Where links in previews can open in-app; without one they open outside the app. */
  readonly linkThreadRef: ScopedThreadRef | null;
  /**
   * Resolves whether the pick took. The picker stays open until then, so nothing is sent from
   * the old checkout in the meantime.
   */
  readonly onPick: (pick: DesktopQuickMessageStartFrom) => Promise<boolean>;
  /** Opens an app path, such as a thread already working on the pick. */
  readonly onOpen: (href: string) => void;
  /** Starts a new automation from the composer; returns whether it did. */
  readonly onNewAutomation?: () => boolean;
  readonly onClose: () => void;
}

interface ExistingThreadsPrompt {
  readonly subject: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly startNew: () => void;
}

export function StartFromPickerDialog(props: StartFromPickerDialogProps) {
  const { environmentId, projectRef, projectId, workspaceRoot, linkThreadRef, onClose } = props;
  const router = useRouter();
  const tabs = props.githubIssuesAvailable ? ALL_TABS : TABS_WITHOUT_GITHUB_ISSUES;
  const [tab, setTab] = useState<StartFromTab>("pull-requests");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<ExistingThreadsPrompt | null>(null);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);

  const projectRefs = [projectRef];
  const threads = useThreadShellsForProjectRefs(projectRefs);

  const [pullRequestView, setPullRequestView] = useState(DEFAULT_PULL_REQUEST_PICKER_VIEW);
  const pullRequestTargets =
    tab === "pull-requests"
      ? [
          {
            environmentId,
            input: {
              state: pullRequestView.state,
              projectId,
              limit: PULL_REQUEST_LIMIT,
              ...(Object.keys(pullRequestView.filters).length > 0
                ? { filters: pullRequestView.filters }
                : {}),
              ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
            },
          },
        ]
      : [];
  const pullRequests = usePullRequestList(pullRequestTargets);
  const loadedPullRequests = pullRequests.data?.entries ?? EMPTY_PULL_REQUESTS;
  const pullRequestEntries = narrowPickerPullRequests(
    loadedPullRequests,
    pullRequests.data?.viewers ?? {},
    pullRequestView,
    debouncedQuery,
  );

  const branches = usePaginatedBranches({
    environmentId: tab === "branches" ? environmentId : null,
    cwd: workspaceRoot,
    query: debouncedQuery,
  });

  const [githubIssueState, setGitHubIssueState] = useState<GitHubIssueStateFilter>("open");
  const githubIssues = useGitHubIssueList({
    environmentId,
    cwd: tab === "issues" ? workspaceRoot : null,
    query,
    state: githubIssueState,
  });
  const githubLinks = useGitHubIssueThreadLinks(tab === "issues" ? environmentId : null);

  const linearConnection = useEnvironmentQuery(
    tab === "linear" ? linearEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const linearConnected = linearConnection.data?.phase === "connected";
  // Shared with the attach picker, so a view set up in one carries over to the other.
  const issueView = useLinearIssuePickerView(environmentId);
  const setIssueView = useLinearIssuePickerViewStore((state) => state.setView);
  const issueFilterOptions = useEnvironmentQuery(
    tab === "linear" && linearConnected
      ? linearEnvironment.filterOptions({ environmentId, input: {} })
      : null,
  );
  const issuesQuery = useEnvironmentQuery(
    tab === "linear" && linearConnected
      ? linearEnvironment.issues({
          environmentId,
          input: { query: debouncedQuery, filters: issueView.filters, sort: issueView.sort },
        })
      : null,
  );
  // A new query starts from an empty atom; keep the last results on screen until it answers.
  const [shownIssues, setShownIssues] = useState(EMPTY_ISSUES);
  const latestIssues = issuesQuery.data?.issues;
  if (latestIssues !== undefined && latestIssues !== shownIssues) setShownIssues(latestIssues);
  const issues = latestIssues ?? shownIssues;
  const linearLinks = useLinearThreadLinks(tab === "linear" ? environmentId : null);

  const tasksQuery = useEnvironmentQuery(
    tab === "automations"
      ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} })
      : null,
  );
  // Filtered at once rather than debounced: the whole list is already here.
  const automations = automationsForPicker(tasksQuery.data?.tasks ?? EMPTY_TASKS, projectId, query);
  const canRunTasks = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId),
  );
  const canCreateTasks = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const runScheduledTask = useRunScheduledTask();
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const close = () => {
    if (!busy) onClose();
  };

  const pick = async (next: DesktopQuickMessageStartFrom) => {
    setBusy(true);
    const applied = await props.onPick(next);
    setBusy(false);
    if (applied) onClose();
  };

  const open = (href: string) => {
    onClose();
    props.onOpen(href);
  };

  /** Starts right away, or first asks whether to open a thread already working on it. */
  const startOrAsk = (
    subject: string,
    existing: ReadonlyArray<EnvironmentThreadShell>,
    start: () => void,
  ) => {
    if (existing.length === 0) start();
    else setPrompt({ subject, threads: existing, startNew: start });
  };

  const selectPullRequest = (entry: EnvironmentPullRequestEntry) =>
    startOrAsk(`#${entry.number}`, threadsForPullRequest(threads, entry), () => {
      void pick({ type: "pull-request", url: entry.url, number: entry.number, title: entry.title });
    });

  const selectBranch = (ref: VcsRef) =>
    startOrAsk(localBranchName(ref), threadsForBranch(threads, ref), () => {
      void pick({ type: "branch", ...resolveBranchStart(ref, workspaceRoot) });
    });

  // The draft is linked as well as given the chip, so picking the issue again offers this thread.
  const selectIssue = (issue: LinearIssueSummary) =>
    startOrAsk(issue.identifier, threadsForLinearIssue(threads, linearLinks, issue.id), () => {
      void pick({
        type: "linear-issue",
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
      });
    });

  const selectGitHubIssue = (issue: GitHubIssueSummary) =>
    startOrAsk(`#${issue.number}`, threadsForGitHubIssue(threads, githubLinks, issue.url), () => {
      void pick({ type: "github-issue", url: issue.url, number: issue.number, title: issue.title });
    });

  const threadHref = (threadRef: ScopedThreadRef) =>
    router.buildLocation({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    }).href;

  const openExistingThread = (thread: EnvironmentThreadShell) => {
    setPrompt(null);
    open(threadHref(scopeThreadRef(thread.environmentId, thread.id)));
  };

  /** Runs the task as Run now does, then opens the thread the run went to. */
  const runAutomation = async (task: ScheduledTask) => {
    setBusy(true);
    const started = await runScheduledTask(environmentId, task);
    setBusy(false);
    if (started === null) return;
    if (started.threadId === null) onClose();
    else open(threadHref(scopeThreadRef(environmentId, started.threadId)));
  };

  const editAutomation = (task: ScheduledTask) =>
    open(
      router.buildLocation({
        to: "/settings/scheduled-tasks",
        search: { environmentId, taskId: task.id },
      }).href,
    );

  const { onNewAutomation } = props;
  const newAutomationFromDraft = () => {
    if (onNewAutomation?.()) onClose();
  };

  const modKey = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const highlightedTask =
    tab === "automations" ? automations.find((task) => task.id === highlighted) : undefined;

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const modPressed = modKey === "⌘" ? event.metaKey : event.ctrlKey;
    if (event.key === "Enter" && modPressed && highlightedTask && canCreateTasks) {
      // Base UI would otherwise also click the highlighted row, running the task.
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      editAutomation(highlightedTask);
      return;
    }
    cycleTab(event);
  };

  const cycleTab = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const index = tabs.findIndex((entry) => entry.id === tab);
    const next = tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length];
    if (next) setTab(next.id);
  };

  const searching = trimmedQuery !== debouncedQuery;
  const listOrStatus = (status: string | null, group: ReactNode) =>
    status === null ? (
      <CommandList>{group}</CommandList>
    ) : (
      <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
    );

  let content: ReactNode;
  if (tab === "pull-requests") {
    const entries = pullRequestEntries;
    content = listOrStatus(
      entries.length > 0
        ? null
        : pullRequests.isPending || searching
          ? "Loading pull requests…"
          : (pullRequests.error ?? "No pull requests match these filters."),
      <CommandGroup items={[...entries]}>
        <CommandCollection>
          {(entry: EnvironmentPullRequestEntry) => {
            const presentation =
              PULL_REQUEST_STATE_PRESENTATION[entry.isDraft ? "draft" : entry.state];
            const inUse = threadsForPullRequest(threads, entry);
            return (
              <CommandItem
                key={entry.url}
                value={entry.url}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectPullRequest(entry)}
              >
                <PullRequestHoverPreview
                  entry={entry}
                  threadRef={linkThreadRef}
                  threads={inUse}
                  trigger={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <presentation.Icon
                        className={cn("size-4 shrink-0", presentation.toneClassName)}
                      />
                      <span className="w-12 shrink-0 text-muted-foreground text-xs tabular-nums">
                        #{entry.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
                      {inUse.length > 0 ? (
                        <Badge variant="outline" size="sm">
                          In use
                        </Badge>
                      ) : null}
                      <span className="w-24 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                        {entry.author?.login ?? ""}
                      </span>
                    </span>
                  }
                />
              </CommandItem>
            );
          }}
        </CommandCollection>
      </CommandGroup>,
    );
  } else if (tab === "branches") {
    const refs = branches.refs;
    content = listOrStatus(
      refs.length > 0
        ? null
        : branches.isPending || searching
          ? "Loading branches…"
          : (branches.error ?? "No branches match."),
      <CommandGroup items={[...refs]}>
        <CommandCollection>
          {(ref: VcsRef) => {
            const inUse = threadsForBranch(threads, ref);
            return (
              <CommandItem
                key={ref.name}
                value={ref.name}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectBranch(ref)}
              >
                <BranchHoverPreview
                  branch={ref}
                  workspaceRoot={workspaceRoot}
                  threads={inUse}
                  trigger={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{ref.name}</span>
                      {inUse.length > 0 ? (
                        <Badge variant="outline" size="sm">
                          In use
                        </Badge>
                      ) : null}
                      {ref.current ? (
                        <Badge variant="secondary" size="sm">
                          current
                        </Badge>
                      ) : ref.isRemote ? (
                        <Badge variant="secondary" size="sm">
                          remote
                        </Badge>
                      ) : null}
                    </span>
                  }
                />
              </CommandItem>
            );
          }}
        </CommandCollection>
      </CommandGroup>,
    );
  } else if (tab === "issues") {
    content = listOrStatus(
      githubIssues.status,
      <CommandGroup items={[...githubIssues.issues]}>
        <CommandCollection>
          {(issue: GitHubIssueSummary) => {
            const inUse = threadsForGitHubIssue(threads, githubLinks, issue.url);
            return (
              <CommandItem
                key={issue.url}
                value={issue.url}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectGitHubIssue(issue)}
              >
                <GitHubIssueHoverPreview
                  environmentId={environmentId}
                  url={issue.url}
                  threadRef={linkThreadRef}
                  threads={inUse}
                  trigger={<GitHubIssueRow issue={issue} inUse={inUse.length > 0} />}
                />
              </CommandItem>
            );
          }}
        </CommandCollection>
      </CommandGroup>,
    );
  } else if (tab === "automations") {
    const timeZone = tasksQuery.data?.timeZone;
    const status =
      automations.length > 0
        ? null
        : tasksQuery.error !== null
          ? `Could not load automations: ${tasksQuery.error}`
          : tasksQuery.data === null
            ? "Loading automations…"
            : trimmedQuery.length > 0
              ? "No automations match."
              : "No automations in this project yet.";
    content = (
      <CommandList>
        {onNewAutomation ? (
          <CommandGroup items={NEW_AUTOMATION_ITEMS}>
            <CommandCollection>
              {(value: string) => (
                <CommandItem
                  key={value}
                  value={value}
                  disabled={busy || !canCreateTasks}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={newAutomationFromDraft}
                >
                  <CalendarPlusIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">New automation from draft</span>
                </CommandItem>
              )}
            </CommandCollection>
          </CommandGroup>
        ) : null}
        {status !== null ? (
          <div className="py-6 text-center text-muted-foreground text-sm">{status}</div>
        ) : (
          <CommandGroup items={automations}>
            <CommandCollection>
              {(task: ScheduledTask) => {
                const blocker = automationRunBlocker(task);
                return (
                  <CommandItem
                    key={task.id}
                    value={task.id}
                    disabled={busy || !canRunTasks || blocker !== null}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void runAutomation(task)}
                  >
                    <AutomationHoverPreview
                      task={task}
                      timeZone={timeZone}
                      trigger={
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                          {!task.enabled ? (
                            <Badge variant="outline" size="sm">
                              Paused
                            </Badge>
                          ) : null}
                          {task.lastRunStatus === "failed" ? (
                            <Badge variant="error" size="sm">
                              Last run failed
                            </Badge>
                          ) : task.lastRunStatus === "running" ? (
                            <Badge variant="info" size="sm">
                              Running
                            </Badge>
                          ) : null}
                          <span className="w-40 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                            {blocker ?? scheduleLabel(task.schedule, timeZone)}
                          </span>
                        </span>
                      }
                    />
                  </CommandItem>
                );
              }}
            </CommandCollection>
          </CommandGroup>
        )}
      </CommandList>
    );
  } else if (linearConnection.data !== null && !linearConnected) {
    content = (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
        <p className="text-muted-foreground">Connect a Linear account to start from an issue.</p>
        <Button
          size="sm"
          onClick={() => {
            open(router.buildLocation({ to: "/settings/integrations" }).href);
          }}
        >
          Connect Linear
        </Button>
      </div>
    );
  } else {
    content = listOrStatus(
      issues.length > 0
        ? null
        : linearConnection.data === null
          ? "Reading Linear status…"
          : issuesQuery.isPending || searching
            ? "Searching Linear…"
            : (issuesQuery.error ?? "No issues match these filters."),
      <CommandGroup items={[...issues]}>
        <CommandCollection>
          {(issue: LinearIssueSummary) => {
            const inUse = threadsForLinearIssue(threads, linearLinks, issue.id);
            return (
              <CommandItem
                key={issue.id}
                value={issue.id}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectIssue(issue)}
              >
                <LinearIssueHoverPreview
                  environmentId={environmentId}
                  issueId={issue.id}
                  trigger={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <LinearIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="w-20 shrink-0 truncate text-muted-foreground text-xs tabular-nums">
                        {issue.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                      {inUse.length > 0 ? (
                        <Badge variant="outline" size="sm">
                          In use
                        </Badge>
                      ) : null}
                      <span className="w-24 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                        {issue.stateName}
                      </span>
                    </span>
                  }
                />
              </CommandItem>
            );
          }}
        </CommandCollection>
      </CommandGroup>,
    );
  }

  const newestExisting = prompt?.threads[0];

  return (
    <>
      <CommandDialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <CommandDialogPopup aria-label="Start from" className="overflow-hidden">
          <CommandPaletteContent
            inputProps={{ placeholder: PLACEHOLDERS[tab], onKeyDown: onInputKeyDown }}
            inputAccessory={
              <>
                <SourceTabs
                  options={tabs}
                  activeId={tab}
                  onSelect={setTab}
                  className="flex gap-1 px-3 pb-2"
                />
                {tab === "pull-requests" ? (
                  <PullRequestPickerFilterBar
                    environmentId={environmentId}
                    projectId={projectId}
                    query={debouncedQuery}
                    list={pullRequests}
                    view={pullRequestView}
                    onChange={setPullRequestView}
                  />
                ) : null}
                {tab === "issues" ? (
                  <GitHubIssueStateTabs state={githubIssueState} onChange={setGitHubIssueState} />
                ) : null}
                {tab === "linear" && linearConnected ? (
                  <LinearIssueFilterBar
                    options={issueFilterOptions.data}
                    optionsError={issueFilterOptions.error}
                    optionsPending={issueFilterOptions.isPending}
                    onRetryOptions={issueFilterOptions.refresh}
                    view={issueView}
                    searching={debouncedQuery.length > 0}
                    onChange={(next) => setIssueView(environmentId, next)}
                  />
                ) : null}
              </>
            }
            footerActionLabel={
              tab === "automations"
                ? highlighted === NEW_AUTOMATION_VALUE
                  ? "New automation"
                  : busy
                    ? "Starting…"
                    : "Run now"
                : tab === "issues" || tab === "linear"
                  ? busy
                    ? "Attaching…"
                    : "Attach"
                  : busy
                    ? "Checking out…"
                    : "Start thread"
            }
            footerTrailing={
              <span className="flex items-center gap-3">
                {highlightedTask && canCreateTasks ? (
                  <KbdGroup>
                    <Kbd>{modKey} Enter</Kbd>
                    <span>Edit</span>
                  </KbdGroup>
                ) : null}
                <span className="text-xs">Tab switches source</span>
              </span>
            }
            mode="none"
            onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
            value={query}
            onValueChange={setQuery}
          >
            {content}
          </CommandPaletteContent>
        </CommandDialogPopup>
      </CommandDialog>

      <AlertDialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <code className="font-medium">{prompt?.subject}</code> already has a thread
            </AlertDialogTitle>
            <AlertDialogDescription>
              {newestExisting ? `“${newestExisting.title}”` : null}
              {prompt && prompt.threads.length > 1
                ? ` and ${prompt.threads.length - 1} more are`
                : " is"}{" "}
              already working on it. Open it, or start a second thread?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="outline"
              onClick={() => {
                const startNew = prompt?.startNew;
                setPrompt(null);
                startNew?.();
              }}
            >
              Start new thread
            </Button>
            <Button
              onClick={() => {
                if (newestExisting) openExistingThread(newestExisting);
              }}
            >
              Open thread
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
