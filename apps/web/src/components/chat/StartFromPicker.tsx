import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  LinearIssueSummary,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  VcsRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/unstable/reactivity";
import { GitBranchIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { cn } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { linearEnvironment } from "~/state/linear";
import { usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue, usePaginatedBranches } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { LinearIcon } from "../Icons";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
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
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useAttachLinearIssue } from "./LinearIssuePicker";
import {
  localBranchName,
  resolveBranchStart,
  threadsForBranch,
  threadsForPullRequest,
} from "./StartFromPicker.logic";

type StartFromTab = "pull-requests" | "branches" | "issues";
const TABS: ReadonlyArray<{ value: StartFromTab; label: string }> = [
  { value: "pull-requests", label: "PRs" },
  { value: "branches", label: "Branches" },
  { value: "issues", label: "Issues" },
];
const PLACEHOLDERS: Record<StartFromTab, string> = {
  "pull-requests": "Search pull requests by title, number, or author",
  branches: "Search branches",
  issues: "Search Linear issues, or paste ENG-123 or an issue link",
};
const SEARCH_DEBOUNCE_MS = 300;
const PULL_REQUEST_LIMIT = 50;
const EMPTY_ISSUES: ReadonlyArray<LinearIssueSummary> = [];

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

interface StartFromPickerProps {
  readonly environmentId: EnvironmentId;
  readonly projectRef: ScopedProjectRef;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  /** The draft's thread, which a picked Linear issue is attached to. */
  readonly threadRef: ScopedThreadRef;
  /** Check a pull request out for the draft, through the pull request thread dialog. */
  readonly onPullRequest: (url: string) => void;
  /** Point the draft at a branch. */
  readonly onBranch: (start: ReturnType<typeof resolveBranchStart>) => Promise<unknown> | void;
}

/** Mounted by a local draft's chat view; shows the picker while it is open. */
export function StartFromPickerHost(props: StartFromPickerProps) {
  const open = useAtomValue(startFromPickerOpenAtom);
  if (!open) return null;
  return <StartFromPickerDialog {...props} />;
}

interface ExistingThreadsPrompt {
  readonly subject: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly startNew: () => void;
}

function StartFromPickerDialog(props: StartFromPickerProps) {
  const { environmentId, projectRef, projectId, workspaceRoot, threadRef } = props;
  const navigate = useNavigate();
  const attachIssue = useAttachLinearIssue();
  const [tab, setTab] = useState<StartFromTab>("pull-requests");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<ExistingThreadsPrompt | null>(null);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);

  const projectRefs = useMemo(() => [projectRef], [projectRef]);
  const threads = useThreadShellsForProjectRefs(projectRefs);

  const pullRequestTargets = useMemo(
    () =>
      tab === "pull-requests"
        ? [
            {
              environmentId,
              input: {
                state: "open" as const,
                projectId,
                limit: PULL_REQUEST_LIMIT,
                ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
              },
            },
          ]
        : [],
    [debouncedQuery, environmentId, projectId, tab],
  );
  const pullRequests = usePullRequestList(pullRequestTargets);

  const branches = usePaginatedBranches({
    environmentId: tab === "branches" ? environmentId : null,
    cwd: workspaceRoot,
    query: debouncedQuery,
  });

  const linearConnection = useEnvironmentQuery(
    tab === "issues" ? linearEnvironment.connection({ environmentId, input: {} }) : null,
  );
  const linearConnected = linearConnection.data?.phase === "connected";
  const issuesQuery = useEnvironmentQuery(
    tab === "issues" && linearConnected
      ? linearEnvironment.issues({ environmentId, input: { query: debouncedQuery } })
      : null,
  );
  const issues = issuesQuery.data?.issues ?? EMPTY_ISSUES;

  const close = () => {
    if (!busy) closeStartFromPicker();
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
      closeStartFromPicker();
      props.onPullRequest(entry.url);
    });

  const selectBranch = (ref: VcsRef) =>
    startOrAsk(localBranchName(ref), threadsForBranch(threads, ref), () => {
      closeStartFromPicker();
      void props.onBranch(resolveBranchStart(ref, workspaceRoot));
    });

  const selectIssue = async (issue: LinearIssueSummary) => {
    setBusy(true);
    const attached = await attachIssue(threadRef, issue.id);
    setBusy(false);
    if (attached) closeStartFromPicker();
  };

  const openExistingThread = (thread: EnvironmentThreadShell) => {
    setPrompt(null);
    closeStartFromPicker();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  const cycleTab = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.value === tab);
    const next = TABS[(index + (event.shiftKey ? TABS.length - 1 : 1)) % TABS.length];
    if (next) setTab(next.value);
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
    const entries = pullRequests.data?.entries ?? [];
    content = listOrStatus(
      entries.length > 0
        ? null
        : pullRequests.isPending || searching
          ? "Loading pull requests…"
          : (pullRequests.error ?? "No open pull requests match."),
      <CommandGroup items={[...entries]}>
        <CommandCollection>
          {(entry: EnvironmentPullRequestEntry) => {
            const presentation =
              PULL_REQUEST_STATE_PRESENTATION[entry.isDraft ? "draft" : entry.state];
            return (
              <CommandItem
                key={entry.url}
                value={entry.url}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectPullRequest(entry)}
              >
                <presentation.Icon className={cn("size-4 shrink-0", presentation.toneClassName)} />
                <span className="w-12 shrink-0 text-muted-foreground text-xs tabular-nums">
                  #{entry.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
                {threadsForPullRequest(threads, entry).length > 0 ? (
                  <Badge variant="outline" size="sm">
                    In use
                  </Badge>
                ) : null}
                <span className="w-24 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                  {entry.author?.login ?? ""}
                </span>
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
          {(ref: VcsRef) => (
            <CommandItem
              key={ref.name}
              value={ref.name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectBranch(ref)}
            >
              <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{ref.name}</span>
              {threadsForBranch(threads, ref).length > 0 ? (
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
            </CommandItem>
          )}
        </CommandCollection>
      </CommandGroup>,
    );
  } else if (linearConnection.data !== null && !linearConnected) {
    content = (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
        <p className="text-muted-foreground">Connect a Linear account to start from an issue.</p>
        <Button
          size="sm"
          onClick={() => {
            closeStartFromPicker();
            void navigate({ to: "/settings/integrations" });
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
            : (issuesQuery.error ?? "No issues match."),
      <CommandGroup items={[...issues]}>
        <CommandCollection>
          {(issue: LinearIssueSummary) => (
            <CommandItem
              key={issue.id}
              value={issue.id}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void selectIssue(issue)}
            >
              <LinearIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="w-20 shrink-0 truncate text-muted-foreground text-xs tabular-nums">
                {issue.identifier}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
              <span className="w-24 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                {issue.stateName}
              </span>
            </CommandItem>
          )}
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
            inputProps={{ placeholder: PLACEHOLDERS[tab], onKeyDown: cycleTab }}
            inputAccessory={
              <div className="flex items-center px-3 pb-2">
                <ToggleGroup
                  aria-label="Start from"
                  value={[tab]}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "pull-requests" || value === "branches" || value === "issues") {
                      setTab(value);
                    }
                  }}
                >
                  {TABS.map((entry) => (
                    <Toggle
                      key={entry.value}
                      value={entry.value}
                      // Keep focus in the search box so arrows and Enter still drive the list.
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      {entry.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
            }
            footerActionLabel={tab === "issues" ? (busy ? "Attaching…" : "Attach") : "Start thread"}
            footerTrailing={<span className="text-xs">Tab switches source</span>}
            mode="none"
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
