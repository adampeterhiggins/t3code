import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { linearIssueContextRecord } from "@t3tools/client-runtime/state/linear";
import type { LinearIssueSummary, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/unstable/reactivity";
import { SquareKanbanIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useLinearIssueContextStore } from "~/linearIssueContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { linearEnvironment } from "~/state/linear";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { CommandPaletteContent } from "../CommandPaletteContent";
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

/**
 * The thread whose composer the picker attaches to, set by whichever entry point asked (the
 * attach menu, the command palette) and rendered once by the chat view, so the picker outlives a
 * palette that closes the moment its command runs.
 */
const linearIssuePickerThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("linear:issue-picker-thread"),
);

export function openLinearIssuePicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linearIssuePickerThreadAtom, threadRef);
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
      useLinearIssueContextStore.getState().upsert(threadRef.threadId, record);
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

/** Mounted once per chat view; shows the picker for whichever thread asked for it. */
export function LinearIssuePickerHost() {
  const threadRef = useAtomValue(linearIssuePickerThreadAtom);
  if (threadRef === null) return null;
  return (
    <LinearIssuePickerDialog
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(linearIssuePickerThreadAtom, null)}
    />
  );
}

function LinearIssuePickerDialog(props: { threadRef: ScopedThreadRef; onClose: () => void }) {
  const { threadRef, onClose } = props;
  const environmentId = threadRef.environmentId;
  const navigate = useNavigate();
  const attachIssue = useAttachLinearIssue();
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
    const attached = await attachIssue(threadRef, issue.id);
    setAttaching(false);
    if (attached) onClose();
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
      <CommandDialogPopup aria-label="Attach Linear issue" className="overflow-hidden">
        {connected || connection.data === null ? (
          <CommandPaletteContent
            inputProps={{
              placeholder: "Search Linear issues, or paste ENG-123 or an issue link",
              startAddon: <SquareKanbanIcon />,
            }}
            footerActionLabel={attaching ? "Attaching…" : "Attach"}
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
                        <span className="w-20 shrink-0 text-muted-foreground text-xs tabular-nums">
                          {issue.identifier}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground text-sm">
                          {issue.title}
                        </span>
                        <span className="shrink-0 text-muted-foreground/70 text-xs">
                          {issue.assigneeName ? `${issue.assigneeName} · ` : ""}
                          {issue.stateName}
                        </span>
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
              Connect a Linear account to attach issues to messages.
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
