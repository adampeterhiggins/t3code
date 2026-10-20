import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { FolderIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { composerRequiresModifier } from "~/composer-logic";
import {
  adoptClientSettings,
  mergeEnvironmentSettings,
  useClientSettings,
} from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  getAppModelOptionsForInstance,
  resolveEffectiveDefaultModelSelection,
  type AppModelOption,
} from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { allReachableShellsLiveAtom } from "~/state/shell";

import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
} from "../chat/ComposerControl";
import { ComposerPrimaryActions } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { DraftProjectName } from "../chat/DraftProjectName";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";

interface ProjectItem {
  readonly value: string;
  readonly label: string;
}

const noop = () => {};
const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

/** Dismisses when the click lands on the transparent window around the composer. */
function dismissOnBackdrop(event: React.PointerEvent<HTMLElement>) {
  if (event.target === event.currentTarget) void window.desktopBridge?.quickMessage?.dismiss();
}

function QuickMessageFrame({ children }: { readonly children: React.ReactNode }) {
  useTheme();
  return (
    <div
      className="flex h-full w-full items-start justify-center px-6 pt-6"
      onPointerDown={dismissOnBackdrop}
    >
      {children}
    </div>
  );
}

export function QuickMessageSignInNotice() {
  return (
    <QuickMessageFrame>
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <p className="px-4 py-4 text-muted-foreground text-sm">
              Open T3 Code to finish signing in, then try again.
            </p>
          </ComposerSurface.Main>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </QuickMessageFrame>
  );
}

/**
 * A floating composer the desktop app opens over any app. It only collects the message, project
 * and model: the main window starts the thread through its own composer, so worktrees, setup
 * scripts and attachments behave as they would for a send there.
 */
export function QuickMessagePanel() {
  const bridge = window.desktopBridge?.quickMessage;
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const shellsLive = useAtomValue(allReachableShellsLiveAtom);
  const clientSettings = useClientSettings();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const [prompt, setPrompt] = useState("");
  const [chosenProjectKey, setChosenProjectKey] = useState<string | null>(null);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerFilter = useComboboxFilter();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onShow((event) => {
      adoptClientSettings(event.clientSettings);
      setError(null);
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    void bridge.setPanelReady().catch(noop);
    return unsubscribe;
  }, [bridge]);

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  // Most recently used first: the panel is for picking up where you were.
  const projectGroups = sortLogicalProjectsForSidebar(
    buildSidebarProjectSnapshots({
      projects: projects.filter((project) => project.isScratch !== true),
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
    }),
    threads,
    "updated_at",
  );
  const projectEntries = buildSidebarProjectPickerEntries({
    groups: projectGroups,
    preferredProjectRef: null,
  });
  const activeEntry =
    projectEntries.find((entry) => entry.group.projectKey === chosenProjectKey) ??
    projectEntries[0] ??
    null;
  const project = activeEntry?.targetProject ?? null;
  const environmentId = project?.environmentId ?? null;
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const serverSettings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const settings = mergeEnvironmentSettings(
    serverSettings ?? DEFAULT_SERVER_SETTINGS,
    clientSettings,
  );
  const providers =
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      project?.id ?? null,
    ),
  );
  const storedDefault = project
    ? resolveDefaultProviderModelSelection(
        providers,
        resolveProjectSettings(settings, project.id, project).settings.defaultModelSelection,
      )
    : null;
  const defaultModel = storedDefault
    ? resolveEffectiveDefaultModelSelection(settings, providers, storedDefault)
    : null;
  const modelSelection =
    chosenModel !== null &&
    instanceEntries.some((entry) => entry.instanceId === chosenModel.instanceId)
      ? chosenModel
      : defaultModel;
  const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of instanceEntries) {
    modelOptionsByInstance.set(
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === modelSelection?.instanceId ? modelSelection.model : null,
      ),
    );
  }

  const environmentUnavailable =
    environment !== undefined && environment.connection.phase !== "connected";
  const sendDisabledReason =
    project === null
      ? shellsLive
        ? "Add a project in T3 Code to start a thread"
        : "Loading projects"
      : modelSelection === null
        ? "Set up a provider in T3 Code to start a thread"
        : null;
  const hasText = prompt.trim().length > 0;

  const submit = async () => {
    const text = prompt.trim();
    if (!bridge || sending || !text || !project || !modelSelection || environmentUnavailable)
      return;
    setSending(true);
    setError(null);
    try {
      await bridge.submit({
        environmentId: project.environmentId,
        projectId: project.id,
        text,
        modelSelection,
      });
      setPrompt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the thread.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void bridge?.dismiss().catch(noop);
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    const needsModifier = composerRequiresModifier(clientSettings.sendShortcut, prompt);
    if (event.shiftKey || (needsModifier && !modifier)) return;
    event.preventDefault();
    void submit();
  };

  const projectItems: ReadonlyArray<ProjectItem> = projectEntries.map(({ group }) => ({
    value: group.projectKey,
    label: group.displayName,
  }));
  const pickerSearch = pickerQuery.trim();
  const filteredProjectItems =
    pickerSearch.length === 0
      ? projectItems
      : projectItems.filter((item) => pickerFilter.contains(item, pickerSearch, (it) => it.label));
  const selectedProjectItem =
    projectItems.find((item) => item.value === activeEntry?.group.projectKey) ?? null;

  return (
    <QuickMessageFrame>
      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <ComposerSurface.Main>
              <div data-chat-composer-surface="true" className="rounded-3xl">
                <div className="relative px-4 pt-4 pb-2">
                  <textarea
                    ref={inputRef}
                    autoFocus
                    rows={1}
                    value={prompt}
                    aria-label="Message"
                    placeholder="Ask anything..."
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={onKeyDown}
                    className="block max-h-52 min-h-6 w-full resize-none bg-transparent font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) text-foreground leading-relaxed [field-sizing:content] placeholder:text-placeholder/75 focus:outline-none"
                  />
                </div>
                {error ? <p className="px-4 pb-2 text-destructive text-xs">{error}</p> : null}
                <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-4 pb-4">
                  <div className="relative -m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {projectItems.length > 0 ? (
                      <Combobox
                        items={projectItems}
                        filteredItems={filteredProjectItems}
                        autoHighlight
                        itemToStringLabel={(item) => item.label}
                        isItemEqualToValue={(a, b) => a.value === b.value}
                        open={pickerOpen}
                        onOpenChange={(open) => {
                          setPickerOpen(open);
                          setPickerQuery("");
                        }}
                        value={selectedProjectItem}
                        onValueChange={(item) => {
                          if (!item) return;
                          setPickerOpen(false);
                          if (item.value === activeEntry?.group.projectKey) return;
                          setChosenProjectKey(item.value);
                          setChosenModel(null);
                          inputRef.current?.focus();
                        }}
                      >
                        <ComboboxTrigger
                          render={<ComposerControl className="-ms-2.5 min-w-0 max-w-56" />}
                          aria-label="Project"
                        >
                          {activeEntry ? (
                            <ProjectFavicon
                              project={activeEntry.group}
                              className="size-4 shrink-0"
                              fallbackIcon={FolderIcon}
                            />
                          ) : (
                            <ComposerControlIcon icon={FolderIcon} />
                          )}
                          <span data-composer-control-label className="min-w-0 truncate">
                            {activeEntry?.group.displayName ?? "Choose a project"}
                          </span>
                          <ComposerControlChevron />
                        </ComboboxTrigger>
                        <ComboboxPopup align="start" className="w-72 overflow-hidden">
                          <ComboboxSearchInput
                            aria-label="Search projects"
                            placeholder="Search projects..."
                            value={pickerQuery}
                            onChange={(event) => setPickerQuery(event.target.value)}
                          />
                          <ComboboxEmpty>No matching projects.</ComboboxEmpty>
                          <ComboboxList>
                            {(item: ProjectItem) => {
                              const entry = projectEntries.find(
                                (candidate) => candidate.group.projectKey === item.value,
                              );
                              return (
                                <ComboboxItem key={item.value} hideIndicator value={item}>
                                  {entry ? (
                                    <ProjectFavicon
                                      project={entry.group}
                                      className="size-4 shrink-0"
                                    />
                                  ) : null}
                                  <span className="min-w-0 flex-1 text-sm">
                                    <DraftProjectName value={item.label} singleLine />
                                  </span>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxPopup>
                      </Combobox>
                    ) : null}
                    {modelSelection !== null ? (
                      <ProviderModelPicker
                        environmentId={environmentId}
                        activeInstanceId={modelSelection.instanceId}
                        model={modelSelection.model}
                        lockedProvider={null}
                        instanceEntries={instanceEntries}
                        modelOptionsByInstance={modelOptionsByInstance}
                        triggerClassName="min-w-13"
                        onInstanceModelChange={(instanceId, model) => {
                          setChosenModel(createModelSelection(instanceId, model));
                          inputRef.current?.focus();
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                    <ComposerPrimaryActions
                      compact={false}
                      canOperateThread
                      pendingAction={null}
                      isRunning={false}
                      canInterrupt={false}
                      showPlanFollowUpPrompt={false}
                      promptHasText={hasText}
                      isSendBusy={sending}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={false}
                      isEnvironmentUnavailable={environmentUnavailable}
                      isPreparingWorktree={false}
                      hasSendableContent={hasText}
                      onPreviousPendingQuestion={noop}
                      onInterrupt={noop}
                      onImplementPlanInNewThread={noop}
                    />
                  </div>
                </div>
              </div>
            </ComposerSurface.Main>
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
      </form>
    </QuickMessageFrame>
  );
}
