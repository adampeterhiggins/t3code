import { useAtomValue } from "@effect/atom-react";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { listThreadTabMemberships } from "@t3tools/client-runtime/thread-tabs";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ThreadId,
  ThreadTabMembership,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  MessageSquareIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { runtime } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import { useProjects, useThreadShells } from "~/state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { usePreparedConnection } from "~/state/session";

import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarTabSummary, threadTimeLabel } from "../sidebar/SidebarTabSummary";
import { Button } from "../ui/button";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  CITATION_DESTINATION_HERE,
  groupCitationDestinations,
  searchCitationDestinationTabs,
  type CitationDestination,
  type CitationDestinationGroup,
} from "./citationDestination";
import { composerFloatingLayerProps } from "./composerEventScope";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getTriggerDisplayModelName } from "./providerIconUtils";

type NewThreadDestination = Extract<CitationDestination, { kind: "new-thread" }>;

/**
 * Tab groups while the picker is open; null where the environment does not serve tabs, so its
 * threads stand alone and offer no new tab.
 */
function useTabMemberships(
  environmentId: EnvironmentId,
  threads: ReadonlyArray<EnvironmentThreadShell>,
  enabled: boolean,
): ReadonlyArray<ThreadTabMembership> | null {
  const prepared = usePreparedConnection(environmentId);
  // Renames and activity updates do not change membership. A new or closed tab does.
  const threadIds = enabled
    ? threads
        .filter((thread) => thread.environmentId === environmentId && thread.archivedAt === null)
        .map((thread) => thread.id)
        .toSorted()
        .join("|")
    : "";
  const [loaded, setLoaded] = useState<{
    connection: PreparedConnection;
    rows: ReadonlyArray<ThreadTabMembership> | null;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads tab membership over RPC while the picker is open
  useEffect(() => {
    if (!enabled || Option.isNone(prepared)) return;
    const connection = prepared.value;
    let active = true;
    runtime.runPromise(listThreadTabMemberships(connection)).then(
      (rows) => {
        if (active) setLoaded({ connection, rows });
      },
      () => {
        // Upstream environments without tabs still expose their ordinary threads.
        if (active) setLoaded({ connection, rows: null });
      },
    );
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new or closed tab refetches; threadIds stands for the shells
  }, [enabled, prepared, threadIds]);
  return Option.isSome(prepared) && loaded?.connection === prepared.value ? loaded.rows : null;
}

/** A model choice for a thread or tab that does not exist yet, like the composer's picker. */
function NewModelPicker({
  environmentId,
  projectId,
  modelSelection,
  onChange,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  modelSelection: ModelSelection;
  onChange: (modelSelection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, projectId),
  );
  const { instanceId, model } = modelSelection;
  return (
    <ProviderModelPicker
      environmentId={environmentId}
      activeInstanceId={instanceId}
      model={model}
      lockedProvider={null}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        settings,
        providers,
        instanceId,
        model,
      )}
      size="xs"
      isComposerOwned
      finalFocus={false}
      onInstanceModelChange={(nextInstanceId, nextModel) =>
        onChange(
          nextInstanceId === instanceId && nextModel === model
            ? modelSelection
            : createModelSelection(nextInstanceId, nextModel),
        )
      }
    />
  );
}

/** The sidebar's tab-count badge; it opens and folds the group's tabs. */
function TabCountToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={open ? "Hide tabs" : count === 1 ? "Show tab" : `Show ${count} tabs`}
      aria-expanded={open}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="-mx-1 inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-sm px-1 text-xs tabular-nums text-muted-foreground/70 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground"
    >
      <LayersIcon aria-hidden className="size-3" />
      {count}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3 transition-[rotate,opacity] motion-reduce:transition-none",
          open ? "rotate-180" : "opacity-0 group-hover/destination-row:opacity-100",
        )}
      />
    </button>
  );
}

function SelectedMark() {
  return <CheckIcon aria-hidden className="size-4 shrink-0 text-foreground" />;
}

/** Labels a tab inside a group that has others, so a toast or trigger says which one. */
function tabDestinationTitle(group: CitationDestinationGroup, tab: EnvironmentThreadShell) {
  return group.tabs.length > 1 && group.title !== tab.title
    ? `${group.title} / ${tab.title}`
    : tab.title;
}

/**
 * The comment panel's "where does this go" control: one tree of threads and their tabs, each
 * thread ending in "New tab", plus "New thread".
 */
export function CitationDestinationPicker({
  environmentId,
  currentThreadId,
  defaultProjectId,
  defaultModelSelection,
  destination,
  onChange,
  onModelPicked,
}: {
  environmentId: EnvironmentId;
  currentThreadId: ThreadId;
  /** What a new thread starts with until the reader changes it: this thread's project and model. */
  defaultProjectId: ProjectId;
  defaultModelSelection: ModelSelection;
  destination: CitationDestination;
  onChange: (destination: CitationDestination) => void;
  /** Picking a model closes the menu; the panel takes focus back rather than the composer. */
  onModelPicked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"destinations" | "new-thread">("destinations");
  const [query, setQuery] = useState("");
  // Remembered while the reader goes back and forth, so a second visit keeps their choices.
  const [newThread, setNewThread] = useState<NewThreadDestination>(() => ({
    kind: "new-thread",
    projectId: defaultProjectId,
    modelSelection: defaultModelSelection,
  }));
  const [expanded, setExpanded] = useState<ReadonlySet<ThreadId>>(() => new Set());
  const returnFocusToPanel = useRef(false);
  const threads = useThreadShells(open);
  const memberships = useTabMemberships(environmentId, threads, open);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  const newThreadProject = projectsById.get(newThread.projectId) ?? null;
  const tabsServed = memberships !== null;

  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const providerEntries = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(providers),
    settings,
    defaultProjectId,
  );
  const providerEntriesById = new Map(providerEntries.map((entry) => [entry.instanceId, entry]));
  const modelLabel = (selection: ModelSelection) => {
    const entry = providerEntriesById.get(selection.instanceId) ?? null;
    const resolved = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options:
        getCustomModelOptionsByInstance(
          settings,
          providers,
          selection.instanceId,
          selection.model,
        ).get(selection.instanceId) ?? [],
    });
    return {
      entry,
      name: resolved ? getTriggerDisplayModelName(resolved, entry?.driverKind) : selection.model,
    };
  };
  const projectTitle = newThreadProject?.title ?? "Unknown project";

  const groups = open
    ? groupCitationDestinations({ threads, memberships, environmentId, currentThreadId })
    : [];
  const search = query.trim().toLocaleLowerCase();
  const matches =
    open && page === "destinations" && search.length > 0
      ? searchCitationDestinationTabs(groups, projectTitles, query)
      : [];
  const projectChoices =
    open && page === "new-thread"
      ? projects
          .filter(
            (project) => search.length === 0 || project.title.toLocaleLowerCase().includes(search),
          )
          .toSorted((a, b) => Number(b.id === defaultProjectId) - Number(a.id === defaultProjectId))
      : [];

  const showPage = (next: typeof page) => {
    setPage(next);
    setQuery("");
  };
  const close = () => {
    setOpen(false);
    showPage("destinations");
  };
  const pick = (next: CitationDestination) => {
    onChange(next);
    close();
  };
  const pickTab = (group: CitationDestinationGroup, tab: EnvironmentThreadShell) =>
    pick(
      tab.id === currentThreadId
        ? CITATION_DESTINATION_HERE
        : { kind: "thread", threadId: tab.id, title: tabDestinationTitle(group, tab) },
    );
  const pickNewTab = (group: CitationDestinationGroup) => {
    const source = group.tabs.find((tab) => tab.id === currentThreadId) ?? group.tabs[0]!;
    onChange({
      kind: "new-tab",
      threadId: source.id,
      title: group.title,
      modelSelection: group.current ? defaultModelSelection : source.modelSelection,
    });
  };
  const toggle = (key: ThreadId) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const updateNewThread = (next: NewThreadDestination) => {
    setNewThread(next);
    onChange(next);
  };
  const modelPicked = () => {
    returnFocusToPanel.current = true;
    close();
  };

  const isPicked = (tab: EnvironmentThreadShell) =>
    tab.id === currentThreadId
      ? destination.kind === "here"
      : destination.kind === "thread" && destination.threadId === tab.id;
  const newTabPickedIn = (group: CitationDestinationGroup) =>
    destination.kind === "new-tab" && group.tabs.some((tab) => tab.id === destination.threadId);
  // The cited thread's group and the one holding the pick start open; a toggle flips that.
  const isExpanded = (group: CitationDestinationGroup) =>
    tabsServed &&
    expanded.has(group.key) !==
      (group.current ||
        newTabPickedIn(group) ||
        (group.tabs.length > 1 && group.tabs.some(isPicked)));

  const tabRow = (group: CitationDestinationGroup, tab: EnvironmentThreadShell, crumb: boolean) => (
    <CommandItem key={tab.id} value={`tab:${tab.id}`} onClick={() => pickTab(group, tab)}>
      {crumb && group.tabs.length > 1 && group.title !== tab.title ? (
        <span className="min-w-0 max-w-[40%] shrink truncate text-sm text-secondary-label">
          {group.title} /
        </span>
      ) : null}
      <SidebarTabSummary
        thread={tab}
        providerEntries={providerEntriesById}
        tabSortOrder="manual"
        openedAt={undefined}
      />
      {tab.id === currentThreadId ? (
        <span className="shrink-0 text-xs text-secondary-label">This tab</span>
      ) : null}
      {isPicked(tab) ? <SelectedMark /> : null}
    </CommandItem>
  );

  const groupRow = (group: CitationDestinationGroup) => {
    const project = projectsById.get(group.projectId);
    const only = group.tabs.length === 1 ? group.tabs[0]! : null;
    const groupOpen = isExpanded(group);
    const newest = group.tabs.reduce((latest, tab) =>
      tab.updatedAt > latest.updatedAt ? tab : latest,
    );
    return (
      <div key={group.key}>
        <CommandItem
          value={`group:${group.key}`}
          className="group/destination-row"
          onClick={() => {
            if (only && !groupOpen) pickTab(group, only);
            else toggle(group.key);
          }}
        >
          <span
            className={cn(
              "flex shrink-0 items-center transition-opacity",
              !group.current &&
                "opacity-40 grayscale group-data-highlighted/destination-row:opacity-100 group-data-highlighted/destination-row:grayscale-0",
            )}
          >
            {project ? (
              <ProjectFavicon project={project} className="size-4" />
            ) : (
              <MessageSquareIcon aria-hidden className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{group.title}</span>
          {tabsServed ? (
            <TabCountToggle
              count={group.tabs.length}
              open={groupOpen}
              onToggle={() => toggle(group.key)}
            />
          ) : null}
          <span className="shrink-0 text-xs tabular-nums text-secondary-label">
            {group.current ? "This thread" : threadTimeLabel(newest)}
          </span>
          {only && !groupOpen && isPicked(only) ? <SelectedMark /> : null}
        </CommandItem>
        {groupOpen ? (
          <div className="relative ms-[calc(var(--sidebar-row-content-inset)+0.4375rem)] flex flex-col gap-px border-s border-sidebar-border ps-1 pb-0.5">
            {group.tabs.map((tab) => tabRow(group, tab, false))}
            <CommandItem value={`new-tab:${group.key}`} onClick={() => pickNewTab(group)}>
              <PlusIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">New tab</span>
              {newTabPickedIn(group) ? <SelectedMark /> : null}
            </CommandItem>
          </div>
        ) : null}
      </div>
    );
  };

  const newThreadModel = modelLabel(newThread.modelSelection);
  const newThreadRow = (
    <CommandItem
      value="new-thread"
      onClick={() => {
        onChange(newThread);
        showPage("new-thread");
      }}
    >
      <SquarePenIcon aria-hidden className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">New thread</span>
        <span className="truncate text-xs text-muted-foreground">
          {projectTitle} · {newThreadModel.name}
        </span>
      </span>
      {destination.kind === "new-thread" ? <SelectedMark /> : null}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </CommandItem>
  );

  const triggerBody = () => {
    if (destination.kind === "new-thread") {
      return (
        <>
          {newThreadProject ? (
            <ProjectFavicon project={newThreadProject} className="size-4 shrink-0" />
          ) : (
            <SquarePenIcon aria-hidden="true" />
          )}
          <span className="truncate">{projectTitle}</span>
          <TriggerProviderIcon entry={newThreadModel.entry} />
        </>
      );
    }
    if (destination.kind === "new-tab") {
      return (
        <>
          <PlusIcon aria-hidden="true" />
          <span className="truncate">{destination.title}</span>
          <span className="text-muted-foreground">/</span>
          <span className="shrink-0">New tab</span>
          <TriggerProviderIcon entry={modelLabel(destination.modelSelection).entry} />
        </>
      );
    }
    return (
      <>
        <MessageSquareIcon aria-hidden="true" />
        <span className="truncate">
          {destination.kind === "here" ? "This thread" : destination.title || "Untitled thread"}
        </span>
      </>
    );
  };
  const label =
    destination.kind === "here"
      ? "This thread"
      : destination.kind === "new-thread"
        ? `New thread in ${projectTitle} with ${newThreadModel.name}`
        : destination.kind === "new-tab"
          ? `New tab in ${destination.title} with ${modelLabel(destination.modelSelection).name}`
          : destination.title || "Untitled thread";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <PopoverTrigger
        aria-label={`Send citation to: ${label}`}
        render={<Button variant="ghost" size="xs" className="min-w-0 max-w-72" />}
      >
        {triggerBody()}
        <ChevronDownIcon aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverPopup
          {...composerFloatingLayerProps}
          side="bottom"
          align="start"
          width="lg"
          padding="none"
          aria-label="Choose where the citation goes"
          finalFocus={() => {
            if (!returnFocusToPanel.current) return true;
            returnFocusToPanel.current = false;
            onModelPicked();
            return false;
          }}
        >
          {page === "destinations" ? (
            <div className="flex min-w-0 flex-col">
              <Command
                mode="none"
                value={query}
                onValueChange={setQuery}
                aria-label="Choose where the citation goes"
              >
                <CommandInput placeholder="Search threads and tabs..." />
                <CommandList className="max-h-96 overflow-y-auto">
                  {search.length > 0 ? (
                    <>
                      {matches.length > 0 ? (
                        <CommandGroup>
                          <CommandGroupLabel>Tabs</CommandGroupLabel>
                          {matches.map(({ group, tab }) => tabRow(group, tab, true))}
                        </CommandGroup>
                      ) : null}
                      <CommandGroup>{newThreadRow}</CommandGroup>
                    </>
                  ) : (
                    <>
                      {groups[0]?.current ? (
                        <CommandGroup>
                          <CommandGroupLabel>This thread</CommandGroupLabel>
                          {groupRow(groups[0])}
                        </CommandGroup>
                      ) : null}
                      {groups.some((group) => !group.current) ? (
                        <CommandGroup>
                          <CommandGroupLabel>Threads</CommandGroupLabel>
                          {groups.filter((group) => !group.current).map(groupRow)}
                        </CommandGroup>
                      ) : null}
                      <CommandGroup>{newThreadRow}</CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
              {destination.kind === "new-tab" ? (
                <div className="flex items-center gap-2 border-t border-border py-1.5 ps-3 pe-1.5">
                  <span className="text-xs text-muted-foreground">New tab model</span>
                  <div className="ms-auto flex min-w-0">
                    <NewModelPicker
                      environmentId={environmentId}
                      projectId={
                        groups.find((group) =>
                          group.tabs.some((tab) => tab.id === destination.threadId),
                        )?.projectId ?? defaultProjectId
                      }
                      modelSelection={destination.modelSelection}
                      onChange={(modelSelection) => {
                        onChange({ ...destination, modelSelection });
                        modelPicked();
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col">
              <Command
                mode="none"
                value={query}
                onValueChange={setQuery}
                aria-label="Choose the new thread's project"
              >
                <CommandInput placeholder="Search projects..." />
                <CommandList className="max-h-72 overflow-y-auto">
                  <CommandItem value="back" onClick={() => showPage("destinations")}>
                    <ChevronLeftIcon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">New thread</span>
                  </CommandItem>
                  <CommandGroup>
                    <CommandGroupLabel>Project</CommandGroupLabel>
                    {projectChoices.map((project) => (
                      <CommandItem
                        key={project.id}
                        value={project.id}
                        onClick={() => updateNewThread({ ...newThread, projectId: project.id })}
                      >
                        <NewThreadProjectIcon project={project} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{project.title}</span>
                          {project.id === defaultProjectId ? (
                            <span className="truncate text-xs text-muted-foreground">
                              This thread's project
                            </span>
                          ) : null}
                        </span>
                        {project.id === newThread.projectId ? (
                          <CheckIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
              <div className="flex items-center gap-2 border-t border-border py-1.5 ps-3 pe-1.5">
                <span className="text-xs text-muted-foreground">Model</span>
                <div className="ms-auto flex min-w-0">
                  <NewModelPicker
                    environmentId={environmentId}
                    projectId={newThread.projectId}
                    modelSelection={newThread.modelSelection}
                    onChange={(modelSelection) => {
                      updateNewThread({ ...newThread, modelSelection });
                      modelPicked();
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}

function TriggerProviderIcon({ entry }: { entry: ProviderInstanceEntry | null }) {
  if (!entry) return null;
  return (
    <ProviderInstanceIcon
      driverKind={entry.driverKind}
      displayName={entry.displayName}
      accentColor={entry.accentColor}
      acpRegistryAgentId={entry.acpRegistryAgentId}
      acpRegistryIconUrl={entry.acpRegistryIconUrl}
      showBadge={false}
      className="size-3.5"
      iconClassName="size-3.5"
    />
  );
}

function NewThreadProjectIcon({ project }: { project: EnvironmentProject }) {
  return <ProjectFavicon project={project} className="size-4 shrink-0" />;
}
