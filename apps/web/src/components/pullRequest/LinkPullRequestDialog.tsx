import {
  type LinkCandidate,
  planLinkSelection,
  pullRequestLinkProject,
  resolveLinkPullRequestInput,
} from "@t3tools/client-runtime/pull-request-link-input";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { useAtomValue } from "@effect/atom-react";
import { type ReactNode, useState } from "react";

import { cn, isMacPlatform } from "~/lib/utils";
import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { useProjects, useServerConfigs, useThreadShell } from "~/state/entities";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";
import { usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue } from "~/state/queries";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Atom } from "effect/reactivity";
import { CommandPaletteContent } from "../CommandPaletteContent";
import {
  DEFAULT_PULL_REQUEST_PICKER_VIEW,
  narrowPickerPullRequests,
  PullRequestPickerFilterBar,
} from "../chat/StartFromPullRequestFilters";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Kbd, KbdGroup } from "../ui/kbd";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "./pullRequestIcons";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";

/**
 * Which thread has the link dialog open, set by whichever entry point asked (command palette,
 * pull-requests surface, detail panel) and rendered once by the chat view so the dialog outlives
 * a palette that closes the moment its command runs.
 */
const linkPullRequestDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("pull-requests:link-dialog-thread"),
);

export function openLinkPullRequestDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkPullRequestDialogThreadAtom, threadRef);
}

/** Mounted once per chat view; shows the picker for whichever thread asked for it. */
export function LinkPullRequestDialogHost() {
  const threadRef = useAtomValue(linkPullRequestDialogThreadAtom);
  const linking = usePullRequestLinking(threadRef?.environmentId);
  if (threadRef === null || linking.mode === "unsupported") return null;
  return (
    <LinkPullRequestPicker
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(linkPullRequestDialogThreadAtom, null)}
    />
  );
}

function applyLabel(plan: ReturnType<typeof planLinkSelection>): string {
  const parts = [
    plan.link.length > 0 ? `Link ${plan.link.length}` : null,
    plan.unlink.length > 0 ? `Unlink ${plan.unlink.length}` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "No changes";
}

const SEARCH_DEBOUNCE_MS = 300;
const PULL_REQUEST_LIMIT = 50;
const EMPTY_PULL_REQUESTS: ReadonlyArray<EnvironmentPullRequestEntry> = [];

function entryCandidate(entry: EnvironmentPullRequestEntry): LinkCandidate {
  return {
    key: threadPullRequestKeyOf(entry),
    url: entry.url,
    repository: entry.repository,
    number: entry.number,
    title: entry.title,
  };
}

/**
 * Checks pull requests on and off the thread, then applies every change at once. Checked rows
 * start as the thread's links, so unchecking one is how it is unlinked. An environment that holds
 * a single link keeps at most one row checked.
 */
function LinkPullRequestPicker({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const thread = useThreadShell(threadRef);
  const projectId = thread?.projectId ?? null;
  const linking = usePullRequestLinking(threadRef.environmentId);
  const multiple = linking.mode === "multiple";
  const canListPullRequests =
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities.pullRequests === true;
  const projects = useProjects();
  const ownProject = pullRequestLinkProject(
    projects.find(
      (candidate) =>
        candidate.environmentId === threadRef.environmentId && candidate.id === projectId,
    )?.repositoryIdentity,
  );

  const linked = ((): ReadonlyArray<LinkCandidate> => {
    if (thread === null) return [];
    if (multiple) {
      return visibleThreadPullRequests(thread.pullRequests).map((link) => ({
        key: threadPullRequestKeyOf(link),
        url: link.url,
        repository: link.repository,
        number: link.number,
        title: link.snapshot?.title ?? null,
      }));
    }
    const single = thread.linkedPullRequest;
    const parsed = single ? parseChangeRequestUrl(single.url) : null;
    if (!single || parsed === null) return [];
    return [
      {
        key: threadPullRequestKeyOf(parsed),
        url: single.url,
        repository: single.repository,
        number: single.number,
        title: null,
      },
    ];
  })();

  // Seeded once from the links the thread had when the picker opened.
  const [selected, setSelected] = useState<ReadonlyMap<string, LinkCandidate>>(
    () => new Map(linked.map((candidate) => [candidate.key, candidate])),
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const [view, setView] = useState(DEFAULT_PULL_REQUEST_PICKER_VIEW);

  const targets = (() =>
    canListPullRequests && projectId !== null
      ? [
          {
            environmentId: threadRef.environmentId,
            input: {
              state: view.state,
              projectId,
              limit: PULL_REQUEST_LIMIT,
              ...(Object.keys(view.filters).length > 0 ? { filters: view.filters } : {}),
              ...(debouncedQuery.length > 0 ? { query: debouncedQuery } : {}),
            },
          },
        ]
      : [])();
  const pullRequests = usePullRequestList(targets);
  const loaded = pullRequests.data?.entries ?? EMPTY_PULL_REQUESTS;
  const listed = (() => {
    const narrowed = narrowPickerPullRequests(
      loaded,
      pullRequests.data?.viewers ?? {},
      view,
      debouncedQuery,
    );
    // The pull request for the thread's own branch is the one most often linked.
    const branch = thread?.branch ?? null;
    return branch === null
      ? narrowed
      : [
          ...narrowed.filter((entry) => entry.headBranch === branch),
          ...narrowed.filter((entry) => entry.headBranch !== branch),
        ];
  })();

  const pasted = (() =>
    resolveLinkPullRequestInput({
      reference: query,
      project: ownProject,
      hasProject: (reference) => linking.canLink(reference.url),
    }))();

  // With no query, the thread's links and anything checked from a paste lead the list, so every
  // checked row can be unchecked without searching for it. Rows checked from the list stay put.
  const pinned = (() => {
    if (trimmedQuery.length > 0) return [];
    const listedKeys = new Set(listed.map((entry) => threadPullRequestKeyOf(entry)));
    const rows = new Map(linked.map((candidate) => [candidate.key, candidate]));
    for (const candidate of selected.values()) {
      if (!rows.has(candidate.key) && !listedKeys.has(candidate.key)) {
        rows.set(candidate.key, candidate);
      }
    }
    return [...rows.values()];
  })();
  const pinnedKeys = new Set(pinned.map((candidate) => candidate.key));
  const listedRows = listed.filter((entry) => !pinnedKeys.has(threadPullRequestKeyOf(entry)));
  const pastedCandidate: LinkCandidate | null =
    pasted !== null && "link" in pasted
      ? {
          key: threadPullRequestKeyOf(pasted.link),
          url: pasted.link.url,
          repository: pasted.link.repository,
          number: pasted.link.number,
          title: null,
        }
      : null;
  const pastedRow =
    pastedCandidate !== null &&
    !listedRows.some((entry) => threadPullRequestKeyOf(entry) === pastedCandidate.key)
      ? pastedCandidate
      : null;

  const toggle = (candidate: LinkCandidate) => {
    setApplyError(null);
    setSelected((current) => {
      if (current.has(candidate.key)) {
        const next = new Map(current);
        next.delete(candidate.key);
        return next;
      }
      const next = multiple ? new Map(current) : new Map<string, LinkCandidate>();
      next.set(candidate.key, candidate);
      return next;
    });
  };

  const plan = planLinkSelection(linked, selected);
  const hasChanges = plan.link.length + plan.unlink.length > 0;

  const apply = async () => {
    if (pending || !hasChanges) return;
    setPending(true);
    setApplyError(null);
    try {
      for (const candidate of plan.unlink) {
        await linking.changeLink(threadRef, candidate.url, false);
      }
      for (const candidate of plan.link) {
        await linking.changeLink(threadRef, candidate.url, true);
      }
    } catch (error) {
      setPending(false);
      setApplyError(error instanceof Error ? error.message : "Could not update the links.");
      return;
    }
    setPending(false);
    onClose();
  };

  const status =
    pastedRow !== null || pinned.length > 0 || listedRows.length > 0
      ? null
      : pasted !== null && "error" in pasted
        ? pasted.error
        : targets.length === 0
          ? "Paste a pull request URL or enter 123 / #123."
          : pullRequests.isPending || trimmedQuery !== debouncedQuery
            ? "Loading pull requests…"
            : (pullRequests.error ?? "No pull requests match these filters.");

  const renderRow = (
    candidate: LinkCandidate,
    trailing: ReactNode,
    icon: ReactNode,
    onToggled?: () => void,
  ) => (
    <CommandItem
      key={candidate.key}
      value={candidate.key}
      disabled={pending}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        toggle(candidate);
        onToggled?.();
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox checked={selected.has(candidate.key)} tabIndex={-1} aria-hidden />
        {icon}
        <span className="w-12 shrink-0 text-muted-foreground text-xs tabular-nums">
          #{candidate.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {candidate.title ?? candidate.repository}
        </span>
        {trailing}
      </span>
    </CommandItem>
  );
  const linkIcon = <PullRequestGlyph.link className="size-4 shrink-0 text-muted-foreground" />;

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <CommandDialogPopup aria-label="Link pull requests" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{
            placeholder: "Search pull requests, or paste a URL or #123",
            startAddon: <PullRequestGlyph.link />,
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
              event.preventDefault();
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              void apply();
            },
          }}
          inputAccessory={
            targets.length > 0 && projectId !== null ? (
              <PullRequestPickerFilterBar
                environmentId={threadRef.environmentId}
                projectId={projectId}
                query={debouncedQuery}
                list={pullRequests}
                view={view}
                onChange={setView}
              />
            ) : null
          }
          footerActionLabel="Select"
          footerTrailing={
            <span className="flex items-center gap-3">
              {applyError !== null ? (
                <span className="max-w-60 truncate text-destructive text-xs">{applyError}</span>
              ) : null}
              <KbdGroup>
                <Kbd>{isMacPlatform(navigator.platform) ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              <Button size="xs" disabled={pending || !hasChanges} onClick={() => void apply()}>
                {pending ? "Saving…" : applyLabel(plan)}
              </Button>
            </span>
          }
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {status !== null ? (
            <div className="py-10 text-center text-muted-foreground text-sm">{status}</div>
          ) : (
            <CommandList>
              {pastedRow !== null ? (
                <CommandGroup items={[pastedRow]}>
                  <CommandCollection>
                    {(candidate: LinkCandidate) =>
                      renderRow(
                        candidate,
                        null,
                        linkIcon,
                        // Back to the pinned rows, where the pasted pull request now sits checked.
                        () => setQuery(""),
                      )
                    }
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              {pinned.length > 0 ? (
                <CommandGroup items={pinned}>
                  <CommandGroupLabel>This thread</CommandGroupLabel>
                  <CommandCollection>
                    {(candidate: LinkCandidate) =>
                      renderRow(
                        candidate,
                        linked.some((entry) => entry.key === candidate.key) ? null : (
                          <span className="shrink-0 text-muted-foreground/70 text-xs">
                            {candidate.repository}
                          </span>
                        ),
                        linkIcon,
                      )
                    }
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              {listedRows.length > 0 ? (
                <CommandGroup items={listedRows}>
                  {pinned.length > 0 ? <CommandGroupLabel>Pull requests</CommandGroupLabel> : null}
                  <CommandCollection>
                    {(entry: EnvironmentPullRequestEntry) => {
                      const presentation =
                        PULL_REQUEST_STATE_PRESENTATION[entry.isDraft ? "draft" : entry.state];
                      return renderRow(
                        entryCandidate(entry),
                        <span className="w-24 shrink-0 truncate text-end text-muted-foreground/70 text-xs">
                          {entry.headBranch === thread?.branch
                            ? "this branch"
                            : (entry.author?.login ?? "")}
                        </span>,
                        <presentation.Icon
                          className={cn("size-4 shrink-0", presentation.toneClassName)}
                        />,
                      );
                    }}
                  </CommandCollection>
                </CommandGroup>
              ) : targets.length > 0 &&
                (pullRequests.isPending || trimmedQuery !== debouncedQuery) ? (
                <div className="px-2 py-3 text-muted-foreground text-xs">
                  Loading pull requests…
                </div>
              ) : null}
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
