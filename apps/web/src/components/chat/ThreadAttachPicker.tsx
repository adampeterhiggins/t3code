import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { listThreadTabMemberships } from "@t3tools/client-runtime/thread-tabs";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import type { ScopedThreadRef, ThreadId, ThreadTabMembership } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "~/providerInstances";
import { runtime } from "~/lib/runtime";
import { usePreparedConnection } from "~/state/session";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";
import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "../sidebar/SidebarTopStatus";
import { CommandPaletteContent } from "../CommandPaletteContent";
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
  composerThreadReferenceItems,
  DEFAULT_THREAD_ATTACH_PICKER_VIEW,
  groupThreadAttachPickerItems,
} from "./composerThreadReferences";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ThreadAttachPickerFilterBar } from "./ThreadAttachPickerFilters";
import { createThreadAttachSummaryLoader } from "./threadAttachPickerSummary";
import { ThreadSummaryPreview } from "./ThreadSummaryPreview";
import { useCaptureThreadTabContext } from "./ThreadTabs";

const THREAD_PICKER_LIMIT = 50;

/** Keeps the destination draft stable while the attach menu or command palette closes. */
const threadAttachPickerTargetAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:thread-attach-picker-target"),
);

export function openThreadAttachPicker(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(threadAttachPickerTargetAtom, threadRef);
}

function closeThreadAttachPicker(): void {
  appAtomRegistry.set(threadAttachPickerTargetAtom, null);
}

/** Mounted once by the chat view; summaries use the same capture path as `@` mentions. */
export function ThreadAttachPickerHost() {
  const threadRef = useAtomValue(threadAttachPickerTargetAtom);
  if (threadRef === null) return null;
  return (
    <ThreadAttachPickerDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
    />
  );
}

function ThreadAttachPickerDialog({ threadRef }: { threadRef: ScopedThreadRef }) {
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const prepared = usePreparedConnection(threadRef.environmentId);
  // Renames and activity updates do not change membership. A new or closed tab does.
  const membershipThreadIds = threads
    .filter(
      (thread) => thread.environmentId === threadRef.environmentId && thread.archivedAt === null,
    )
    .map((thread) => thread.id)
    .toSorted()
    .join("|");
  const [tabMemberships, setTabMemberships] = useState<{
    connection: PreparedConnection;
    threadIds: string;
    rows: ReadonlyArray<ThreadTabMembership>;
  } | null>(null);
  useEffect(() => {
    if (Option.isNone(prepared)) return;
    const connection = prepared.value;
    let active = true;
    const store = (rows: ReadonlyArray<ThreadTabMembership>) => {
      if (active) setTabMemberships({ connection, threadIds: membershipThreadIds, rows });
    };
    runtime.runPromise(listThreadTabMemberships(connection)).then(store, () => {
      // Upstream environments without tabs still expose their ordinary threads.
      store([]);
    });
    return () => {
      active = false;
    };
  }, [prepared, membershipThreadIds]);
  const membershipsReady =
    Option.isNone(prepared) ||
    (tabMemberships?.connection === prepared.value &&
      tabMemberships.threadIds === membershipThreadIds);
  const memberships =
    Option.isSome(prepared) && tabMemberships?.connection === prepared.value
      ? tabMemberships.rows
      : undefined;
  const captureContext = useCaptureThreadTabContext(threadRef.environmentId, threadRef.threadId);
  const loadSummary = useMemo(
    () =>
      captureContext === null ? null : createThreadAttachSummaryLoader(captureContext.fetchSummary),
    [captureContext],
  );
  const [query, setQuery] = useState("");
  const [view, setView] = useState(DEFAULT_THREAD_ATTACH_PICKER_VIEW);
  const [attaching, setAttaching] = useState(false);
  const attachInFlight = useRef(false);
  const entries = useMemo(
    () =>
      composerThreadReferenceItems({
        threads,
        projects,
        environmentId: threadRef.environmentId,
        excludeThreadIds: new Set([threadRef.threadId]),
        query,
        limit: THREAD_PICKER_LIMIT,
        view,
        ...(memberships ? { tabMemberships: memberships } : {}),
      }),
    [threads, projects, threadRef, query, view, memberships],
  );
  const groups = useMemo(() => groupThreadAttachPickerItems(entries), [entries]);
  const threadsById = useMemo(
    () =>
      new Map(
        threads
          .filter((thread) => thread.environmentId === threadRef.environmentId)
          .map((thread) => [thread.id, thread]),
      ),
    [threads, threadRef.environmentId],
  );
  const projectsById = useMemo(
    () =>
      new Map(
        projects
          .filter((project) => project.environmentId === threadRef.environmentId)
          .map((project) => [project.id, project]),
      ),
    [projects, threadRef.environmentId],
  );
  const providerEntries = useMemo(
    () =>
      new Map(
        deriveProviderInstanceEntries(
          serverConfigs.get(threadRef.environmentId)?.providers ?? [],
        ).map((provider) => [provider.instanceId, provider]),
      ),
    [serverConfigs, threadRef.environmentId],
  );
  const projectOf = (threadId: ThreadId) => {
    const thread = threadsById.get(threadId);
    return thread ? projectsById.get(thread.projectId) : undefined;
  };
  const filterOptions = useMemo(() => {
    const availableThreads = threads.filter(
      (thread) =>
        thread.environmentId === threadRef.environmentId &&
        thread.archivedAt === null &&
        thread.id !== threadRef.threadId,
    );
    const projectIds = new Set(availableThreads.map((thread) => thread.projectId));
    const providers = new Map(
      availableThreads.map((thread) => [
        thread.modelSelection.instanceId,
        providerEntries.get(thread.modelSelection.instanceId)?.displayName ??
          thread.runtime?.providerName ??
          thread.modelSelection.instanceId,
      ]),
    );
    return {
      projects: projects
        .filter(
          (project) =>
            project.environmentId === threadRef.environmentId && projectIds.has(project.id),
        )
        .map((project) => ({ value: project.id, label: project.title }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
      providers: [...providers]
        .map(([value, label]) => ({ value, label }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    };
  }, [threads, projects, threadRef, providerEntries]);

  async function select(entry: (typeof entries)[number]) {
    if (attachInFlight.current || captureContext === null || loadSummary === null) return;
    attachInFlight.current = true;
    setAttaching(true);
    try {
      const summary = await loadSummary(entry.threadId);
      const reference = await captureContext.capture(entry.threadId, entry.label, summary);
      useComposerDraftStore.getState().insertContextReference(threadRef, reference);
      // A dismissed picker may have been reopened for a different draft during capture.
      if (appAtomRegistry.get(threadAttachPickerTargetAtom) === threadRef) {
        closeThreadAttachPicker();
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not attach that thread",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      attachInFlight.current = false;
      setAttaching(false);
    }
  }

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) closeThreadAttachPicker();
      }}
    >
      <CommandDialogPopup aria-label="Attach thread" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{ placeholder: "Search threads by title", startAddon: <MessageSquareIcon /> }}
          footerActionLabel={attaching ? "Attaching…" : "Attach"}
          inputAccessory={
            <ThreadAttachPickerFilterBar {...filterOptions} view={view} onChange={setView} />
          }
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          {!membershipsReady ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              Loading thread tabs…
            </div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              {query.trim() || view.projectIds.length > 0 || view.providerInstanceIds.length > 0
                ? "No threads match these filters."
                : "No other threads to attach."}
            </div>
          ) : (
            <CommandList>
              {groups.map((group) => {
                const isTabGroup = group.parentTitle !== null;
                return (
                  <CommandGroup key={group.id} items={group.entries}>
                    {/* A thread's tabs hang off one side rule, each an ordinary row. */}
                    <div className={isTabGroup ? "my-1 ml-4 border-l pl-1" : undefined}>
                      <CommandCollection>
                        {(entry: (typeof entries)[number]) => (
                          <CommandItem
                            key={entry.id}
                            value={entry.id}
                            disabled={attaching || captureContext === null}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void select(entry)}
                          >
                            <CursorPreviewCard
                              trigger={
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                  <ThreadProjectIcon project={projectOf(entry.threadId)} />
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {entry.label}
                                  </span>
                                  <ThreadProviderIcon
                                    thread={threadsById.get(entry.threadId)}
                                    providerEntries={providerEntries}
                                  />
                                  <ThreadActivityMeta thread={threadsById.get(entry.threadId)} />
                                </span>
                              }
                            >
                              <ThreadSummaryPreview
                                environmentId={threadRef.environmentId}
                                threadId={entry.threadId}
                                title={entry.label}
                                parentTitle={entry.parentThreadTitle}
                                loadSummary={loadSummary}
                              />
                            </CursorPreviewCard>
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </div>
                  </CommandGroup>
                );
              })}
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function ThreadProjectIcon(props: {
  project: Parameters<typeof ProjectFavicon>[0]["project"] | undefined;
}) {
  return props.project ? (
    <ProjectFavicon project={props.project} className="size-4 shrink-0" />
  ) : (
    <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
  );
}

/** The thread's provider glyph, badged like the sidebar when two instances share a driver. */
function ThreadProviderIcon(props: {
  thread: EnvironmentThreadShell | undefined;
  providerEntries: ReadonlyMap<string, ReturnType<typeof deriveProviderInstanceEntries>[number]>;
}) {
  const { thread, providerEntries } = props;
  if (!thread) return null;
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const entry = providerEntries.get(instanceId);
  if (!entry) return null;
  return (
    <span className="inline-flex shrink-0 items-center">
      <ProviderInstanceIcon
        driverKind={entry.driverKind}
        displayName={entry.displayName}
        accentColor={entry.accentColor}
        showBadge={shouldShowInstanceBadge(entry, providerEntries.values())}
        iconClassName="size-3.5 opacity-60"
        badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
      />
    </span>
  );
}

/** The sidebar's status and last-activity time, so rows read the same in both places. */
function ThreadActivityMeta({ thread }: { thread: EnvironmentThreadShell | undefined }) {
  const threadKey = thread
    ? scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
    : null;
  const lastVisitedAt = useUiStateStore((state) =>
    threadKey === null ? undefined : state.threadLastVisitedAtById[threadKey],
  );
  if (!thread) return null;
  const status = resolveSidebarTopStatus(
    resolveSidebarThreadStatus(thread),
    false,
    hasUnseenCompletion({ ...thread, lastVisitedAt }),
  );
  const time = formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt);
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs">
      {status ? (
        <span className={`inline-flex items-center gap-1 font-medium ${status.className}`}>
          <SidebarTopStatusIcon icon={status.icon} className="size-3.5 shrink-0" />
          {status.label}
        </span>
      ) : null}
      {/* A fixed slot keeps the provider icons and statuses in one column. */}
      <span className="min-w-16 text-right text-muted-foreground tabular-nums">{time}</span>
    </span>
  );
}
