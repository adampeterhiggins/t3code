import { useAtomValue } from "@effect/atom-react";
import {
  describeContextRepositoryGitStatus,
  findContextRepositoryClone,
  pastedContextRepositoryEntry,
  rankContextRepositoryCandidates,
  repositoryContextRecord,
  splitContextRepositoryOwnerQuery,
} from "@t3tools/client-runtime/context-repositories";
import type {
  ContextRepositoryCandidate,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { ExternalLinkIcon, FolderGit2Icon, LockIcon, LockOpenIcon } from "lucide-react";
import { useState } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useRepositoryContextStore } from "~/repositoryContextStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const OWNER_DEBOUNCE_MS = 300;
const RECENTS_STORAGE_KEY = "t3code:context-repository-recents";
const MAX_RECENTS = 30;
const EMPTY_CANDIDATES: ReadonlyArray<ContextRepositoryCandidate> = [];

/**
 * The thread whose composer the picker attaches to, set by whichever entry point asked (the
 * attach menu, the command palette) and rendered once by the chat view.
 */
const repositoryAttachPickerThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:repository-attach-picker-thread"),
);

export function openRepositoryAttachPicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(repositoryAttachPickerThreadAtom, threadRef);
}

export function readRepositoryRecents(): ReadonlyArray<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Most recent first, like ctxclone's completion ranking. */
function recordRecent(nameWithOwner: string): void {
  try {
    const next = [
      nameWithOwner,
      ...readRepositoryRecents().filter((entry) => entry !== nameWithOwner),
    ];
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)));
  } catch {
    // Ranking is a nicety; a full or blocked storage just loses it.
  }
}

/** Drops a repository chip into the thread's composer; the clone happens when the message sends. */
export function attachRepository(
  threadRef: ScopedThreadRef,
  input: { nameWithOwner: string; remoteUrl: string },
): void {
  const record = repositoryContextRecord(input);
  useRepositoryContextStore.getState().upsert(threadRef.threadId, record);
  useComposerDraftStore.getState().insertContextReference(threadRef, {
    kind: "repository",
    contextId: record.contextId,
    label: record.label,
  });
  recordRecent(record.nameWithOwner);
}

/**
 * Mounted once per chat view; shows the picker for whichever thread asked for it. `workspaceCwd`
 * is where the thread's clones live, when it has a workspace yet, so the list can say which
 * repositories are already there.
 */
export function RepositoryAttachPickerHost(props: { workspaceCwd: string | null }) {
  const threadRef = useAtomValue(repositoryAttachPickerThreadAtom);
  if (threadRef === null) return null;
  return (
    <RepositoryAttachPickerDialog
      threadRef={threadRef}
      workspaceCwd={props.workspaceCwd}
      onClose={() => appAtomRegistry.set(repositoryAttachPickerThreadAtom, null)}
    />
  );
}

/**
 * Flush right on a row, shown on hover or keyboard highlight: opens the repository in the
 * browser without attaching it. Only web URLs get one; an ssh remote has nothing to open.
 */
function OpenRepositoryButton(props: { threadRef: ScopedThreadRef; url: string }) {
  const openLink = useLinkClickHandler(props.threadRef);
  if (!/^https?:\/\//i.test(props.url)) return null;
  return (
    <span className="flex shrink-0 opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/row:opacity-100 in-data-highlighted:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Open repository"
              render={<a href={props.url} target="_blank" rel="noreferrer" />}
              // Keep focus in the search box, and do not attach the row.
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                openLink(event, props.url);
              }}
            >
              <ExternalLinkIcon />
            </Button>
          }
        />
        <TooltipPopup side="top" align="center">
          Open repository
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}

function RepositoryAttachPickerDialog(props: {
  threadRef: ScopedThreadRef;
  workspaceCwd: string | null;
  onClose: () => void;
}) {
  const { threadRef, workspaceCwd, onClose } = props;
  const environmentId: EnvironmentId = threadRef.environmentId;
  const navigate = useNavigate();
  const defaultOwner = useEnvironmentSettings(
    environmentId,
    (settings) => settings.contextRepositoryOwner,
  );
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const { owner, filter } = splitContextRepositoryOwnerQuery(trimmedQuery, defaultOwner);
  const debouncedOwner = useDebouncedValue(owner, OWNER_DEBOUNCE_MS);
  const listQuery = useEnvironmentQuery(
    debouncedOwner.length > 0
      ? sourceControlEnvironment.contextRepositories({
          environmentId,
          input: { owner: debouncedOwner },
        })
      : null,
  );
  const clonesQuery = useEnvironmentQuery(
    workspaceCwd
      ? sourceControlEnvironment.contextRepositoryClones({
          environmentId,
          input: { cwd: workspaceCwd },
        })
      : null,
  );
  const candidates = listQuery.data?.repositories ?? EMPTY_CANDIDATES;
  // Read once per open: attaching closes the picker, so the ranking cannot go stale here.
  const [recentRank] = useState(
    () => new Map(readRepositoryRecents().map((name, index) => [name, index] as const)),
  );
  const shown = rankContextRepositoryCandidates(candidates, filter, recentRank);

  const pastedEntry = pastedContextRepositoryEntry(trimmedQuery, shown);

  function select(input: { nameWithOwner: string; remoteUrl: string }) {
    attachRepository(threadRef, input);
    onClose();
  }

  const clones = clonesQuery.data?.clones ?? [];
  const directory = clonesQuery.data?.directory ?? ".context";
  const workspaceBadge = (remoteUrl: string) => {
    const clone = findContextRepositoryClone(clones, remoteUrl);
    if (!clone) return null;
    return (
      <span className="shrink-0 truncate text-muted-foreground/70 text-xs">
        In {directory}/{clone.directoryName}
        {clone.git ? ` · ${describeContextRepositoryGitStatus(clone.git)}` : ""}
      </span>
    );
  };

  const needsOwner = owner.length === 0 && !pastedEntry;
  const status = needsOwner
    ? null
    : listQuery.error !== null && shown.length === 0 && !pastedEntry
      ? listQuery.error
      : shown.length === 0 && !pastedEntry
        ? listQuery.isPending || owner !== debouncedOwner
          ? `Listing ${owner}'s repositories…`
          : `No repositories in ${owner} match.`
        : null;

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup aria-label="Attach repository" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{
            placeholder: defaultOwner
              ? `Search ${defaultOwner}, type another-org/, or paste a repository URL`
              : "Type an owner like acme/, or paste a repository URL",
            startAddon: <FolderGit2Icon />,
          }}
          footerActionLabel="Attach"
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {needsOwner ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
              <p className="text-muted-foreground">
                Type an owner followed by a slash to list its repositories, or set a default owner
                so the list opens ready.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onClose();
                  void navigate({ to: "/settings/general" });
                }}
              >
                Set default owner
              </Button>
            </div>
          ) : status !== null ? (
            <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
          ) : (
            <CommandList>
              {pastedEntry ? (
                <CommandGroup items={[pastedEntry]}>
                  <CommandCollection>
                    {(entry: { nameWithOwner: string; remoteUrl: string }) => (
                      <CommandItem
                        key={`pasted:${entry.remoteUrl}`}
                        value={`pasted:${entry.remoteUrl}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => select(entry)}
                      >
                        <span className="group/row flex min-w-0 flex-1 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-foreground text-sm">
                            {entry.nameWithOwner}
                          </span>
                          {workspaceBadge(entry.remoteUrl) ?? (
                            <span className="shrink-0 truncate text-muted-foreground/70 text-xs">
                              {entry.remoteUrl}
                            </span>
                          )}
                          <OpenRepositoryButton threadRef={threadRef} url={entry.remoteUrl} />
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              <CommandGroup items={[...shown]}>
                <CommandCollection>
                  {(candidate: ContextRepositoryCandidate) => (
                    <CommandItem
                      key={candidate.nameWithOwner}
                      value={candidate.nameWithOwner}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        select({
                          nameWithOwner: candidate.nameWithOwner,
                          remoteUrl: candidate.url,
                        })
                      }
                    >
                      <span className="group/row flex min-w-0 flex-1 items-center gap-2">
                        {candidate.isPrivate ? (
                          <LockIcon
                            aria-label="Private"
                            className="size-3 shrink-0 text-muted-foreground/70"
                          />
                        ) : (
                          <LockOpenIcon
                            aria-label="Public"
                            className="size-3 shrink-0 text-muted-foreground/70"
                          />
                        )}
                        {/* A fixed width so descriptions line up down the list. */}
                        <span className="w-44 shrink-0 truncate text-foreground text-sm">
                          {candidate.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                          {candidate.description ?? ""}
                        </span>
                        {workspaceBadge(candidate.url)}
                        <OpenRepositoryButton threadRef={threadRef} url={candidate.url} />
                      </span>
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
