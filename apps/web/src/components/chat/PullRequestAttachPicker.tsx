import { ContextMenu } from "@base-ui/react/context-menu";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { MessageCircleIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { pullRequestEnvironment, usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { CommandPaletteContent } from "../CommandPaletteContent";
import {
  buildPullRequestCommentReferenceContext,
  buildPullRequestReferenceContext,
  pullRequestCommentChoiceLocation,
  pullRequestCommentChoices,
  type PullRequestCommentChoice,
  visibleBody,
} from "../pullRequest/pullRequestDetail.logic";
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
import { MenuItem, MenuPopup } from "../ui/menu";
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
  // Right-click → "Attach a comment…" swaps the list for that pull request's comments.
  const [commentsOf, setCommentsOf] = useState<EnvironmentPullRequestEntry | null>(null);
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closePullRequestAttachPicker();
      }}
    >
      <CommandDialogPopup aria-label="Attach pull request" className="overflow-hidden">
        {commentsOf === null ? (
          <PullRequestList {...props} onPickComment={setCommentsOf} />
        ) : (
          <PullRequestCommentList
            entry={commentsOf}
            threadRef={props.threadRef}
            onBack={() => setCommentsOf(null)}
          />
        )}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function PullRequestList(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadRef: ScopedThreadRef;
  onPickComment: (entry: EnvironmentPullRequestEntry) => void;
}) {
  const { environmentId, projectId, threadRef } = props;
  const [query, setQuery] = useState("");
  // The row the context menu was opened on; the menu is closed whenever this is null.
  const [menuEntry, setMenuEntry] = useState<EnvironmentPullRequestEntry | null>(null);
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
    <ContextMenu.Root
      open={menuEntry !== null}
      onOpenChange={(open, details) => {
        // One menu serves every row, so it names whichever row was right-clicked.
        const target = details.event?.target;
        const url =
          open && target instanceof Element
            ? target.closest("[data-pull-request-url]")?.getAttribute("data-pull-request-url")
            : null;
        setMenuEntry(entries.find((entry) => entry.url === url) ?? null);
      }}
    >
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
          <ContextMenu.Trigger render={<CommandList />}>
            <CommandGroup items={[...entries]}>
              <CommandCollection>
                {(entry: EnvironmentPullRequestEntry) => {
                  const presentation =
                    PULL_REQUEST_STATE_PRESENTATION[entry.isDraft ? "draft" : entry.state];
                  return (
                    <CommandItem
                      key={entry.url}
                      value={entry.url}
                      data-pull-request-url={entry.url}
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
          </ContextMenu.Trigger>
        )}
      </CommandPaletteContent>
      <MenuPopup>
        {menuEntry === null ? null : (
          <>
            <MenuItem onClick={() => select(menuEntry)}>Attach pull request</MenuItem>
            <MenuItem onClick={() => props.onPickComment(menuEntry)}>Attach a comment…</MenuItem>
          </>
        )}
      </MenuPopup>
    </ContextMenu.Root>
  );
}

/** One pull request's comments, newest first; a picked one lands as its own chip. */
function PullRequestCommentList(props: {
  entry: EnvironmentPullRequestEntry;
  threadRef: ScopedThreadRef;
  onBack: () => void;
}) {
  const { entry, threadRef } = props;
  const [query, setQuery] = useState("");
  const activity = useEnvironmentQuery(
    pullRequestEnvironment.activity({
      environmentId: entry.environmentId,
      input: {
        projectId: entry.projectId,
        host: entry.host,
        repository: entry.repository,
        number: entry.number,
      },
    }),
  );
  const choices = useMemo(
    () => (activity.data === null ? [] : pullRequestCommentChoices(activity.data).toReversed()),
    [activity.data],
  );
  const needle = query.trim().toLowerCase();
  const shown =
    needle.length === 0
      ? choices
      : choices.filter((choice) =>
          [
            choice.comment.author?.login ?? "",
            choice.comment.body,
            pullRequestCommentChoiceLocation(choice),
          ].some((field) => field.toLowerCase().includes(needle)),
        );

  const select = (choice: PullRequestCommentChoice) => {
    useComposerDraftStore
      .getState()
      .addReviewComment(threadRef, buildPullRequestCommentReferenceContext(entry, choice));
    closePullRequestAttachPicker();
  };

  const status =
    shown.length > 0
      ? null
      : activity.isPending
        ? "Loading comments…"
        : (activity.error ??
          (choices.length === 0
            ? "This pull request has no comments."
            : "No comments match this search."));

  return (
    <CommandPaletteContent
      inputProps={{
        placeholder: `Search comments on #${entry.number} by author or text`,
        startAddon: <MessageCircleIcon />,
        onKeyDown: (event) => {
          if (event.key === "Backspace" && query.length === 0) {
            event.preventDefault();
            props.onBack();
          }
        },
      }}
      footerActionLabel="Attach"
      showBackHint
      mode="none"
      value={query}
      onValueChange={setQuery}
    >
      {status !== null ? (
        <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
      ) : (
        <CommandList>
          <CommandGroup items={shown}>
            <CommandCollection>
              {(choice: PullRequestCommentChoice) => (
                <CommandItem
                  key={choice.comment.id}
                  value={choice.comment.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(choice)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-sm">
                      {choice.comment.author?.login ?? "ghost"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
                      {(visibleBody(choice.comment.body) ?? "").replace(/\s+/gu, " ")}
                    </span>
                    <span className="w-28 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                      {pullRequestCommentChoiceLocation(choice)}
                    </span>
                    <span className="w-16 shrink-0 text-end text-muted-foreground/70 text-xs tabular-nums">
                      {formatRelativeTimeLabel(choice.comment.createdAt)}
                    </span>
                  </span>
                </CommandItem>
              )}
            </CommandCollection>
          </CommandGroup>
        </CommandList>
      )}
    </CommandPaletteContent>
  );
}
