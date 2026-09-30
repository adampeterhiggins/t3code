import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue } from "~/state/queries";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { buildPullRequestReferenceContext } from "../pullRequest/pullRequestDetail.logic";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { PullRequestHoverPreview } from "./StartFromPreviews";
import {
  DEFAULT_PULL_REQUEST_PICKER_VIEW,
  narrowPickerPullRequests,
  PullRequestPickerFilterBar,
} from "./StartFromPullRequestFilters";

const SEARCH_DEBOUNCE_MS = 300;
const PULL_REQUEST_LIMIT = 50;
const EMPTY_PULL_REQUESTS: ReadonlyArray<EnvironmentPullRequestEntry> = [];
const NO_THREADS: never[] = [];

/**
 * The thread whose composer the picker attaches to, set by whichever entry point asked (the
 * attach menu, the command palette) and rendered once by the chat view, so the picker outlives a
 * palette that closes the moment its command runs.
 */
const pullRequestAttachPickerThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:pull-request-attach-picker-thread"),
);

export function openPullRequestAttachPicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(pullRequestAttachPickerThreadAtom, threadRef);
}

function closePullRequestAttachPicker(): void {
  appAtomRegistry.set(pullRequestAttachPickerThreadAtom, null);
}

/**
 * Mounted by a chat view whose project can list pull requests; shows the picker for whichever
 * thread asked for it. A picked pull request lands as the same chip `#` inserts.
 */
export function PullRequestAttachPickerHost(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const threadRef = useAtomValue(pullRequestAttachPickerThreadAtom);
  if (threadRef === null) return null;
  return <PullRequestAttachPickerDialog {...props} threadRef={threadRef} />;
}

function PullRequestAttachPickerDialog(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadRef: ScopedThreadRef;
}) {
  const { environmentId, projectId, threadRef } = props;
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const [view, setView] = useState(DEFAULT_PULL_REQUEST_PICKER_VIEW);
  const targets = useMemo(
    () => [
      {
        environmentId,
        input: {
          state: view.state,
          projectId,
          limit: PULL_REQUEST_LIMIT,
          ...(Object.keys(view.filters).length > 0 ? { filters: view.filters } : {}),
          ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
        },
      },
    ],
    [debouncedQuery, environmentId, projectId, view],
  );
  const pullRequests = usePullRequestList(targets);
  const loaded = pullRequests.data?.entries ?? EMPTY_PULL_REQUESTS;
  const entries = useMemo(
    () => narrowPickerPullRequests(loaded, pullRequests.data?.viewers ?? {}, view, debouncedQuery),
    [debouncedQuery, loaded, pullRequests.data?.viewers, view],
  );

  const select = (entry: EnvironmentPullRequestEntry) => {
    useComposerDraftStore
      .getState()
      .addReviewComment(threadRef, buildPullRequestReferenceContext(entry));
    closePullRequestAttachPicker();
  };

  const status =
    entries.length > 0
      ? null
      : pullRequests.isPending || trimmedQuery !== debouncedQuery
        ? "Loading pull requests…"
        : (pullRequests.error ?? "No pull requests match these filters.");

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePullRequestAttachPicker();
      }}
    >
      <CommandDialogPopup aria-label="Attach pull request" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{
            placeholder: "Search pull requests by title, number, or author",
            startAddon: <PullRequestGlyph.pullRequest />,
          }}
          inputAccessory={
            <PullRequestPickerFilterBar entries={loaded} view={view} onChange={setView} />
          }
          footerActionLabel="Attach"
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {status !== null ? (
            <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
          ) : (
            <CommandList>
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
                        onClick={() => select(entry)}
                      >
                        <PullRequestHoverPreview
                          entry={entry}
                          threadRef={threadRef}
                          threads={NO_THREADS}
                          trigger={
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <presentation.Icon
                                className={cn("size-4 shrink-0", presentation.toneClassName)}
                              />
                              <span className="w-12 shrink-0 text-muted-foreground text-xs tabular-nums">
                                #{entry.number}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
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
              </CommandGroup>
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
