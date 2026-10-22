import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  SquarePenIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { useProjects, useThreadShells } from "~/state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";

import { ProjectFavicon } from "../ProjectFavicon";
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
  rankCitationDestinationThreads,
  type CitationDestination,
} from "./citationDestination";
import { composerFloatingLayerProps } from "./composerEventScope";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getTriggerDisplayModelName } from "./providerIconUtils";

type NewThreadDestination = Extract<CitationDestination, { kind: "new-thread" }>;

/** The comment panel's "where does this go" control: this thread, a new thread, or any other. */
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
  const returnFocusToPanel = useRef(false);
  const threads = useThreadShells(open);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  const newThreadProject = projects.find((project) => project.id === newThread.projectId) ?? null;

  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      newThread.projectId,
    ),
  );
  const { instanceId, model } = newThread.modelSelection;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    instanceId,
    model,
  );
  const modelEntry = instanceEntries.find((entry) => entry.instanceId === instanceId) ?? null;
  const resolvedModel = resolveModelPickerSelectedModel({
    driverKind: modelEntry?.driverKind,
    model,
    options: modelOptionsByInstance.get(instanceId) ?? [],
  });
  const modelName = resolvedModel ? getTriggerDisplayModelName(resolvedModel) : model;
  const projectTitle = newThreadProject?.title ?? "Unknown project";

  const candidates =
    open && page === "destinations"
      ? rankCitationDestinationThreads({
          threads,
          projectTitles,
          environmentId,
          currentThreadId,
          query,
        })
      : [];
  const search = query.trim().toLocaleLowerCase();
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
  const updateNewThread = (next: NewThreadDestination) => {
    setNewThread(next);
    onChange(next);
  };

  const label =
    destination.kind === "here"
      ? "This thread"
      : destination.kind === "new-thread"
        ? `New thread in ${projectTitle} with ${modelName}`
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
        render={<Button variant="ghost" size="xs" className="min-w-0 max-w-52" />}
      >
        {destination.kind === "new-thread" ? (
          <>
            {newThreadProject ? (
              <NewThreadProjectIcon project={newThreadProject} />
            ) : (
              <SquarePenIcon aria-hidden="true" />
            )}
            <span className="truncate">{projectTitle}</span>
            {modelEntry ? (
              <ProviderInstanceIcon
                driverKind={modelEntry.driverKind}
                displayName={modelEntry.displayName}
                accentColor={modelEntry.accentColor}
                acpRegistryAgentId={modelEntry.acpRegistryAgentId}
                acpRegistryIconUrl={modelEntry.acpRegistryIconUrl}
                showBadge={false}
                className="size-3.5"
                iconClassName="size-3.5"
              />
            ) : null}
          </>
        ) : (
          <>
            <MessageSquareIcon aria-hidden="true" />
            <span className="truncate">{label}</span>
          </>
        )}
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
            <Command
              mode="none"
              value={query}
              onValueChange={setQuery}
              aria-label="Choose where the citation goes"
            >
              <CommandInput placeholder="Search threads..." />
              <CommandList className="max-h-72 overflow-y-auto">
                <CommandItem value="here" onClick={() => pick(CITATION_DESTINATION_HERE)}>
                  <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                  <span className="flex-1 truncate">This thread</span>
                </CommandItem>
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
                      {projectTitle} · {modelName}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </CommandItem>
                {candidates.length > 0 ? (
                  <CommandGroup>
                    <CommandGroupLabel>Threads</CommandGroupLabel>
                    {candidates.map(({ thread, projectTitle, running }) => (
                      <CommandItem
                        key={thread.id}
                        value={thread.id}
                        onClick={() =>
                          pick({ kind: "thread", threadId: thread.id, title: thread.title })
                        }
                      >
                        <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{thread.title || "Untitled thread"}</span>
                          {projectTitle ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {projectTitle}
                            </span>
                          ) : null}
                        </span>
                        {running ? (
                          <span className="text-xs text-muted-foreground">Working</span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
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
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={instanceId}
                    model={model}
                    lockedProvider={null}
                    instanceEntries={instanceEntries}
                    modelOptionsByInstance={modelOptionsByInstance}
                    size="xs"
                    isComposerOwned
                    finalFocus={false}
                    onInstanceModelChange={(nextInstanceId, nextModel) => {
                      const unchanged = nextInstanceId === instanceId && nextModel === model;
                      updateNewThread({
                        ...newThread,
                        modelSelection: unchanged
                          ? newThread.modelSelection
                          : createModelSelection(nextInstanceId, nextModel),
                      });
                      returnFocusToPanel.current = true;
                      close();
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

function NewThreadProjectIcon({ project }: { project: EnvironmentProject }) {
  return <ProjectFavicon project={project} className="size-4 shrink-0" />;
}
