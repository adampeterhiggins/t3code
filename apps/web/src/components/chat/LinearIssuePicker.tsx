import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { linearIssueContextRecord } from "@t3tools/shared/composerContextReferences";
import type { LinearIssueSummary, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { LinearIcon } from "../Icons";
import { useCallback, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { linearEnvironment } from "~/state/linear";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { LinearIssueHoverPreview } from "./LinearIssueHoverPreview";
import {
  LinearIssueFilterBar,
  useLinearIssuePickerView,
  useLinearIssuePickerViewStore,
} from "./LinearIssueFilters";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { toastManager } from "../ui/toast";

// Linear allows 30 searches a minute, so typing settles before a search goes out.
const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_ISSUES: ReadonlyArray<LinearIssueSummary> = [];

type LinearIssuePickerMode = "attach" | "link";

/**
 * The thread the picker acts on and what picking does: attach the issue to that thread's composer,
 * or link it to the thread's tab group. Set by whichever entry point asked (the attach menu, the
 * thread menu, the command palette) and rendered once by the chat view, so the picker outlives a
 * palette that closes the moment its command runs.
 */
const linearIssuePickerAtom = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly mode: LinearIssuePickerMode;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("linear:issue-picker-thread"));

export function openLinearIssuePicker(
  threadRef: ScopedThreadRef,
  mode: LinearIssuePickerMode = "attach",
): void {
  appAtomRegistry.set(linearIssuePickerAtom, { threadRef, mode });
}

/**
 * Fetches an issue and drops its chip into the thread's composer. The issue is snapshotted now,
 * so the message keeps what the agent saw even if the issue changes later.
 */
export function useAttachLinearIssue() {
  const getIssue = useAtomCommand(linearEnvironment.getIssue, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, issueId: string): Promise<boolean> => {
      const result = await getIssue({
        environmentId: threadRef.environmentId,
        input: { id: issueId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not attach the Linear issue",
            description: failure instanceof Error ? failure.message : undefined,
          });
        }
        return false;
      }
      const record = linearIssueContextRecord(result.value);
      useIssueContextStore.getState().upsert(threadRef.threadId, record);
      useComposerDraftStore.getState().insertContextReference(threadRef, {
        kind: "linear-issue",
        contextId: record.contextId,
        label: record.label,
      });
      return true;
    },
    [getIssue],
  );
}

/** Links an issue to the thread's tab group, replacing the one it had. */
export function useLinkLinearIssue() {
  const linkThread = useAtomCommand(linearEnvironment.linkThread, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef, issueId: string): Promise<boolean> => {
      const result = await linkThread({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, issueId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not link the Linear issue",
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

/** Mounted once per chat view; shows the picker for whichever thread asked for it. */
export function LinearIssuePickerHost() {
  const target = useAtomValue(linearIssuePickerAtom);
  if (target === null) return null;
  return (
    <LinearIssuePickerDialog
      threadRef={target.threadRef}
      mode={target.mode}
      onClose={() => appAtomRegistry.set(linearIssuePickerAtom, null)}
    />
  );
}

function LinearIssuePickerDialog(props: {
  threadRef: ScopedThreadRef;
  mode: LinearIssuePickerMode;
  onClose: () => void;
}) {
  const { threadRef, mode, onClose } = props;
  const environmentId = threadRef.environmentId;
  const navigate = useNavigate();
  const attachIssue = useAttachLinearIssue();
  const linkIssue = useLinkLinearIssue();
  const [query, setQuery] = useState("");
  const [attaching, setAttaching] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId, input: {} }),
  );
  const connected = connection.data?.phase === "connected";
  const view = useLinearIssuePickerView(environmentId);
  const setView = useLinearIssuePickerViewStore((state) => state.setView);
  const filterOptions = useEnvironmentQuery(
    connected ? linearEnvironment.filterOptions({ environmentId, input: {} }) : null,
  );
  const issuesQuery = useEnvironmentQuery(
    connected
      ? linearEnvironment.issues({
          environmentId,
          input: { query: debouncedQuery, filters: view.filters, sort: view.sort },
        })
      : null,
  );
  // A new query starts from an empty atom; keep the last results on screen until it answers.
  const [shownIssues, setShownIssues] = useState(EMPTY_ISSUES);
  const latestIssues = issuesQuery.data?.issues;
  if (latestIssues !== undefined && latestIssues !== shownIssues) setShownIssues(latestIssues);
  const issues = latestIssues ?? shownIssues;
  const searching = issuesQuery.isPending || query.trim() !== debouncedQuery;

  async function select(issue: LinearIssueSummary) {
    if (attaching) return;
    setAttaching(true);
    const done = await (mode === "link" ? linkIssue : attachIssue)(threadRef, issue.id);
    setAttaching(false);
    if (done) onClose();
  }

  const status =
    connection.data === null
      ? "Reading Linear status…"
      : !connected
        ? null
        : issuesQuery.error !== null && issues.length === 0
          ? issuesQuery.error
          : issues.length === 0
            ? searching
              ? "Searching Linear…"
              : "No issues match these filters."
            : null;

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup
        aria-label={mode === "link" ? "Link Linear issue" : "Attach Linear issue"}
        className="overflow-hidden"
      >
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search Linear issues, or paste ENG-123 or an issue link",
              startAddon: <LinearIcon />,
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
            inputAccessory={
              <LinearIssueFilterBar
                options={filterOptions.data}
                view={view}
                searching={debouncedQuery.length > 0}
                onChange={(next) => setView(environmentId, next)}
              />
            }
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
                    {(issue: LinearIssueSummary) => (
                      <CommandItem
                        key={issue.id}
                        value={issue.id}
                        disabled={attaching}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void select(issue)}
                      >
                        <LinearIssueHoverPreview
                          environmentId={environmentId}
                          issueId={issue.id}
                          trigger={
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="w-20 shrink-0 truncate text-muted-foreground text-xs tabular-nums">
                                {issue.identifier}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground text-sm">
                                {issue.title}
                              </span>
                              {/* Fixed widths so assignee and status line up down the list. */}
                              <span className="w-28 shrink-0 truncate text-muted-foreground/70 text-xs">
                                {issue.assigneeName ?? "Unassigned"}
                              </span>
                              <span className="w-24 shrink-0 truncate text-muted-foreground/70 text-xs">
                                {issue.stateName}
                              </span>
                            </span>
                          }
                        />
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            )}
          </CommandPaletteContent>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">
              {mode === "link"
                ? "Connect a Linear account to link an issue to this thread."
                : "Connect a Linear account to attach issues to messages."}
            </p>
            <Button
              size="sm"
              onClick={() => {
                onClose();
                void navigate({ to: "/settings/integrations" });
              }}
            >
              Connect Linear
            </Button>
          </div>
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}
