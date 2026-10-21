import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthSourceControlWriteScope,
  DEFAULT_SERVER_SETTINGS,
  type DesktopQuickMessageAttachment,
  type DesktopQuickMessageStartFrom,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderInstanceId,
  type RuntimeMode,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  CircleDotIcon,
  EllipsisIcon,
  FileIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  LaptopIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { composerRequiresModifier } from "~/composer-logic";
import {
  adoptClientSettings,
  mergeEnvironmentSettings,
  useClientSettings,
} from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { randomUUID } from "~/lib/utils";
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
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { allReachableShellsLiveAtom } from "~/state/shell";

import {
  ComposerFooterModeControls,
  composerRuntimeModeOptions,
} from "../chat/ComposerFooterControls";
import {
  ComposerAttachMenu,
  type ComposerAttachPicker,
  openComposerAttachPicker,
} from "../chat/ComposerAttachMenu";
import { ComposerAttachRedirect } from "../chat/composerAttachRedirect";
import { CheckoutAttachPickerHost } from "../chat/CheckoutAttachPicker";
import { DiscordMessagePickerHost } from "../chat/DiscordMessagePicker";
import { GitHubIssuePickerHost } from "../chat/GitHubIssuePicker";
import { GranolaNotePickerHost } from "../chat/GranolaNotePicker";
import { LinearIssuePickerHost } from "../chat/LinearIssuePicker";
import { NotionPagePickerHost } from "../chat/NotionPagePicker";
import { PullRequestAttachPickerHost } from "../chat/PullRequestAttachPicker";
import { RepositoryAttachPickerHost } from "../chat/RepositoryAttachPicker";
import { SlackMessagePickerHost } from "../chat/SlackMessagePicker";
import { ThreadAttachPickerHost } from "../chat/ThreadAttachPicker";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  ComposerControlSeparator,
} from "../chat/ComposerControl";
import { ComposerPrimaryActions } from "../chat/ComposerPrimaryActions";
import { ComposerImageThumbnail } from "../chat/ComposerImageThumbnail";
import { ComposerSurface } from "../chat/ComposerSurface";
import { DraftProjectName } from "../chat/DraftProjectName";
import { StartFromPickerDialog } from "../chat/StartFromPicker";
import { DiscordIcon, GitHubIcon, GranolaIcon, LinearIcon, NotionIcon, SlackIcon } from "../Icons";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { ProviderAccountPicker } from "../chat/ProviderAccountPicker";
import {
  accountsForProvider,
  resolveModelForAccountSwitch,
  shouldShowProviderAccountPicker,
} from "../chat/providerAccountSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { shouldRenderTraitsControls, TraitsPicker } from "../chat/TraitsPicker";
import { useComposerCheckoutItems } from "../chat/useComposerCheckoutItems";
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
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ProjectItem {
  readonly value: string;
  readonly label: string;
}

const NO_PROJECT_VALUE = "no-project";
const noop = () => {};
const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

/** The composer's attach menu, gated the same way it is in a project's own draft. */
function QuickMessageAttachMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject;
  readonly pullRequestsAvailable: boolean;
  readonly onAttachFiles: () => void;
  readonly onPick: (picker: ComposerAttachPicker) => void;
}) {
  const checkouts = useComposerCheckoutItems(props.environmentId, { enabled: false, query: "" });
  return (
    <ComposerAttachMenu
      environmentId={props.environmentId}
      pullRequestsAvailable={props.pullRequestsAvailable}
      githubIssuesAvailable={isGitHubProject(props.project)}
      checkoutsAvailable={checkouts.hasLocalCandidates}
      onAttachFiles={props.onAttachFiles}
      onPick={props.onPick}
    />
  );
}

/**
 * The thread the panel's attach pickers are opened for. It never reaches a draft: the pickers hand
 * their picks back through `ComposerAttachRedirect`, and the main window attaches them on send.
 */
const PICKER_THREAD_ID = ThreadId.make("quick-message-panel");

const ATTACHMENT_ICONS = {
  thread: MessageSquareIcon,
  "linear-issue": LinearIcon,
  "notion-page": NotionIcon,
  "granola-note": GranolaIcon,
  "slack-message": SlackIcon,
  "discord-message": DiscordIcon,
  "github-issue": GitHubIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  checkout: LaptopIcon,
  repository: FolderGit2Icon,
} satisfies Record<DesktopQuickMessageAttachment["type"], unknown>;

function startFromChip(startFrom: DesktopQuickMessageStartFrom) {
  switch (startFrom.type) {
    case "pull-request":
      return {
        icon: PullRequestGlyph.pullRequest,
        label: `#${startFrom.number} ${startFrom.title}`,
      };
    case "branch":
      return { icon: GitBranchIcon, label: startFrom.branch };
    case "github-issue":
      return { icon: CircleDotIcon, label: `#${startFrom.number} ${startFrom.title}` };
    case "linear-issue":
      return { icon: LinearIcon, label: `${startFrom.identifier} ${startFrom.title}` };
  }
}

function PickChip(props: {
  readonly icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}) {
  const Icon = props.icon;
  return (
    <span className="inline-flex max-w-72 items-center gap-1.5 rounded-lg bg-muted py-0.5 ps-2 pe-0.5 text-muted-foreground text-xs">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{props.label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={props.removeLabel}
        onClick={props.onRemove}
      >
        <XIcon />
      </Button>
    </span>
  );
}

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
  const [scratchProject, setScratchProject] = useState<EnvironmentProject | null>(null);
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const projectSelectionRequest = useRef(0);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [chosenRuntimeMode, setChosenRuntimeMode] = useState<RuntimeMode | null>(null);
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const [files, setFiles] = useState<ReadonlyArray<{ readonly id: string; readonly file: File }>>(
    [],
  );
  const [startFrom, setStartFrom] = useState<DesktopQuickMessageStartFrom | null>(null);
  const [attachments, setAttachments] = useState<
    ReadonlyArray<{ readonly id: string; readonly attachment: DesktopQuickMessageAttachment }>
  >([]);
  const [startFromOpen, setStartFromOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerFilter = useComboboxFilter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const project =
    chosenProjectKey === NO_PROJECT_VALUE ? scratchProject : (activeEntry?.targetProject ?? null);
  const scratchTargetEnvironmentId = project?.environmentId ?? primaryEnvironmentId;
  const scratchEnvironment = environments.find(
    (entry) => entry.environmentId === scratchTargetEnvironmentId,
  );
  const canStartWithoutProject =
    availableScratchWorkspaceRoot(
      scratchEnvironment?.connection.phase,
      scratchEnvironment?.serverConfig,
    ) !== null;
  const environmentId = project?.environmentId ?? null;
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  // The same gate the draft's chat view puts on its own start-from picker, which applies the pick.
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canStartFrom = canWriteSourceControl && chosenProjectKey !== NO_PROJECT_VALUE;
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
  const projectSettings = project
    ? resolveProjectSettings(settings, project.id, project).settings
    : null;
  const storedDefault = projectSettings
    ? resolveDefaultProviderModelSelection(providers, projectSettings.defaultModelSelection)
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

  const providerEntry = instanceEntries.find(
    (entry) => entry.instanceId === modelSelection?.instanceId,
  );
  const providerAccounts = providerEntry
    ? accountsForProvider({ entries: instanceEntries, driverKind: providerEntry.driverKind })
    : [];
  const supportedRuntimeModes = providerEntry?.snapshot.supportedRuntimeModes;
  const runtimeModeOptions =
    supportedRuntimeModes && supportedRuntimeModes.length > 0
      ? composerRuntimeModeOptions.filter((option) => supportedRuntimeModes.includes(option.mode))
      : composerRuntimeModeOptions;
  const requestedRuntimeMode =
    chosenRuntimeMode ?? projectSettings?.defaultRuntimeMode ?? settings.defaultRuntimeMode;
  const runtimeMode = runtimeModeOptions.some((option) => option.mode === requestedRuntimeMode)
    ? requestedRuntimeMode
    : (runtimeModeOptions[0]?.mode ?? requestedRuntimeMode);
  const planModeEnabled = settings.planModeEnabled;
  const showTraits =
    modelSelection !== null &&
    providerEntry !== undefined &&
    shouldRenderTraitsControls({
      provider: providerEntry.driverKind,
      models: providerEntry.models,
      model: modelSelection.model,
      prompt,
      modelOptions: modelSelection.options ?? [],
      planModeEnabled,
    });

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
  const hasContent = hasText || files.length > 0 || attachments.length > 0;

  const submit = async () => {
    if (!bridge || sending || !project || !modelSelection || environmentUnavailable) return;
    setSending(true);
    setError(null);
    try {
      await bridge.submit({
        type: "draft",
        environmentId: project.environmentId,
        projectId: project.id,
        text: prompt.trim(),
        files: await Promise.all(
          files.map(async ({ file }) => ({
            name: file.name,
            mimeType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
        modelSelection,
        runtimeMode,
        interactionMode: planModeEnabled ? interactionMode : "default",
        ...(startFrom !== null ? { startFrom } : {}),
        attachments: attachments.map((entry) => entry.attachment),
      });
      setPrompt("");
      setFiles([]);
      setStartFrom(null);
      setAttachments([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the thread.");
    } finally {
      setSending(false);
    }
  };

  const addFiles = (added: ReadonlyArray<File>) => {
    if (added.length === 0) return;
    setFiles((current) => [...current, ...added.map((file) => ({ id: randomUUID(), file }))]);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
  };
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length === 0) return;
    event.preventDefault();
    addFiles(dropped);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      // A menu opened by mouse can leave focus here; its own Escape closes just the menu.
      if (event.currentTarget.form?.querySelector("[data-popup-open]")) return;
      event.preventDefault();
      void bridge?.dismiss().catch(noop);
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    const needsModifier = composerRequiresModifier(clientSettings.sendShortcut, prompt);
    if (event.shiftKey || (needsModifier && !modifier)) return;
    event.preventDefault();
    if (hasContent) void submit();
  };

  const projectItems: ReadonlyArray<ProjectItem> = [
    ...(canStartWithoutProject || chosenProjectKey === NO_PROJECT_VALUE
      ? [{ value: NO_PROJECT_VALUE, label: "No project" }]
      : []),
    ...projectEntries.map(({ group }) => ({
      value: group.projectKey,
      label: group.displayName,
    })),
  ];
  const pickerSearch = pickerQuery.trim();
  const filteredProjectItems =
    pickerSearch.length === 0
      ? projectItems
      : projectItems.filter((item) => pickerFilter.contains(item, pickerSearch, (it) => it.label));
  const selectedProjectItem =
    projectItems.find(
      (item) =>
        item.value ===
        (chosenProjectKey === NO_PROJECT_VALUE ? NO_PROJECT_VALUE : activeEntry?.group.projectKey),
    ) ?? null;

  return (
    <QuickMessageFrame>
      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
            inputRef.current?.focus();
          }}
        />
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <ComposerSurface.Main>
              <div data-chat-composer-surface="true" className="rounded-3xl">
                <div className="relative px-4 pt-4 pb-2">
                  {project && canStartFrom ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="absolute end-2 top-2 z-10 sm:end-2.5 sm:top-2.5"
                            aria-label="Start from a pull request, branch, or issue"
                            onClick={() => setStartFromOpen(true)}
                          />
                        }
                      >
                        <EllipsisIcon />
                      </TooltipTrigger>
                      <TooltipPopup>Start from a PR, branch, or issue</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {projectItems.length > 0 ? (
                    <div className="-mt-1.5 mb-1 flex pe-7">
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
                        onValueChange={async (item) => {
                          if (!item) return;
                          setPickerOpen(false);
                          const request = ++projectSelectionRequest.current;
                          if (item.value === selectedProjectItem?.value) return;
                          setError(null);
                          if (item.value === NO_PROJECT_VALUE) {
                            if (scratchTargetEnvironmentId === null) return;
                            const result = await openScratch({
                              environmentId: scratchTargetEnvironmentId,
                              input: {},
                            });
                            if (request !== projectSelectionRequest.current) return;
                            if (isAtomCommandInterrupted(result)) return;
                            if (result._tag !== "Success") {
                              const cause = squashAtomCommandFailure(result);
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Could not start without a project.",
                              );
                              return;
                            }
                            setScratchProject(result.value);
                          }
                          setChosenProjectKey(item.value);
                          setChosenModel(null);
                          setStartFrom(null);
                          setAttachments([]);
                          inputRef.current?.focus();
                        }}
                      >
                        <ComboboxTrigger
                          render={<ComposerControl className="-ms-2.5 min-w-0 max-w-72" />}
                          aria-label="Project"
                        >
                          {chosenProjectKey === NO_PROJECT_VALUE ? (
                            <ComposerControlIcon icon={FolderIcon} />
                          ) : activeEntry ? (
                            <ProjectFavicon
                              project={activeEntry.group}
                              className="size-4 shrink-0"
                              fallbackIcon={FolderIcon}
                            />
                          ) : (
                            <ComposerControlIcon icon={FolderIcon} />
                          )}
                          <span data-composer-control-label className="min-w-0 truncate">
                            {selectedProjectItem?.label ?? "Choose a project"}
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
                                  {item.value === NO_PROJECT_VALUE ? (
                                    <FolderIcon className="size-4 shrink-0" />
                                  ) : entry ? (
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
                    </div>
                  ) : null}
                  {files.length > 0 || startFrom !== null || attachments.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 pe-7 pb-2">
                      {startFrom !== null ? (
                        <PickChip
                          {...startFromChip(startFrom)}
                          removeLabel="Don't start from this"
                          onRemove={() => {
                            setStartFrom(null);
                            inputRef.current?.focus();
                          }}
                        />
                      ) : null}
                      {attachments.map(({ id, attachment }) => (
                        <PickChip
                          key={id}
                          icon={ATTACHMENT_ICONS[attachment.type]}
                          label={attachment.label}
                          removeLabel={`Remove ${attachment.label}`}
                          onRemove={() => {
                            setAttachments((current) => current.filter((entry) => entry.id !== id));
                            inputRef.current?.focus();
                          }}
                        />
                      ))}
                      {files.map(({ id, file }) =>
                        file.type.startsWith("image/") ? (
                          <div
                            key={id}
                            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-background"
                          >
                            <ComposerImageThumbnail
                              file={file}
                              alt={file.name}
                              className="h-full w-full"
                              fallback={
                                <span className="flex h-full items-center justify-center px-1 text-center text-3xs text-secondary-label">
                                  {file.name}
                                </span>
                              }
                            />
                            <Button
                              type="button"
                              variant="media-close"
                              size="icon-xs"
                              className="absolute right-1 top-1"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setFiles((current) => current.filter((entry) => entry.id !== id))
                              }
                            >
                              <XIcon />
                            </Button>
                          </div>
                        ) : (
                          <span
                            key={id}
                            className="inline-flex max-w-56 items-center gap-1.5 rounded-lg bg-muted py-0.5 ps-2 pe-0.5 text-muted-foreground text-xs"
                          >
                            <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 truncate">{file.name}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setFiles((current) => current.filter((entry) => entry.id !== id))
                              }
                            >
                              <XIcon />
                            </Button>
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                  <textarea
                    ref={inputRef}
                    autoFocus
                    rows={1}
                    value={prompt}
                    aria-label="Message"
                    placeholder="Ask anything..."
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    className="block max-h-52 min-h-12 w-full pe-7 resize-none bg-transparent font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) text-foreground leading-relaxed [field-sizing:content] placeholder:text-placeholder/75 focus:outline-none"
                  />
                </div>
                {error ? <p className="px-4 pb-2 text-destructive text-xs">{error}</p> : null}
                <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-4 pb-4 sm:gap-0">
                  <div className="relative -m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {modelSelection !== null ? (
                      <ProviderModelPicker
                        environmentId={environmentId}
                        activeInstanceId={modelSelection.instanceId}
                        model={modelSelection.model}
                        lockedProvider={null}
                        instanceEntries={instanceEntries}
                        modelOptionsByInstance={modelOptionsByInstance}
                        isComposerOwned
                        triggerClassName="-ms-2.5 min-w-13"
                        onInstanceModelChange={(instanceId, model) => {
                          setChosenModel(createModelSelection(instanceId, model));
                          inputRef.current?.focus();
                        }}
                      />
                    ) : null}
                    {showTraits && modelSelection !== null && providerEntry ? (
                      <>
                        <ComposerControlSeparator />
                        <TraitsPicker
                          provider={providerEntry.driverKind}
                          instanceId={modelSelection.instanceId}
                          models={providerEntry.models}
                          model={modelSelection.model}
                          prompt={prompt}
                          onPromptChange={setPrompt}
                          modelOptions={modelSelection.options ?? []}
                          planModeEnabled={planModeEnabled}
                          isComposerOwned
                          onModelOptionsChange={(options) =>
                            setChosenModel(
                              createModelSelection(
                                modelSelection.instanceId,
                                modelSelection.model,
                                options,
                              ),
                            )
                          }
                        />
                      </>
                    ) : null}
                    {project ? (
                      <ComposerFooterModeControls
                        showInteractionModeToggle={planModeEnabled}
                        interactionMode={interactionMode}
                        runtimeMode={runtimeMode}
                        runtimeModeOptions={runtimeModeOptions}
                        onToggleInteractionMode={() =>
                          setInteractionMode((mode) => (mode === "plan" ? "default" : "plan"))
                        }
                        onRuntimeModeChange={setChosenRuntimeMode}
                      />
                    ) : null}
                    {modelSelection !== null &&
                    shouldShowProviderAccountPicker(providerAccounts) ? (
                      <>
                        <ComposerControlSeparator />
                        <ProviderAccountPicker
                          isComposerOwned
                          activeInstanceId={modelSelection.instanceId}
                          accounts={providerAccounts}
                          onAccountChange={(instanceId) => {
                            setChosenModel(
                              createModelSelection(
                                instanceId,
                                resolveModelForAccountSwitch({
                                  currentModel: modelSelection.model,
                                  destinationModels: modelOptionsByInstance.get(instanceId) ?? [],
                                }),
                              ),
                            );
                            inputRef.current?.focus();
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                    {project && environmentId ? (
                      <QuickMessageAttachMenu
                        environmentId={environmentId}
                        project={project}
                        pullRequestsAvailable={
                          environment?.serverConfig?.environment.capabilities.pullRequests === true
                        }
                        onAttachFiles={() => fileInputRef.current?.click()}
                        onPick={(picker) =>
                          openComposerAttachPicker(
                            picker,
                            scopeThreadRef(environmentId, PICKER_THREAD_ID),
                          )
                        }
                      />
                    ) : null}
                    <ComposerPrimaryActions
                      compact={false}
                      canOperateThread
                      pendingAction={null}
                      isRunning={false}
                      canInterrupt={false}
                      showPlanFollowUpPrompt={false}
                      promptHasText={hasText}
                      createWithoutMessage={
                        !project?.isScratch && projectSettings?.defaultThreadEnvMode === "worktree"
                          ? "worktree"
                          : "thread"
                      }
                      isSendBusy={sending}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={false}
                      isEnvironmentUnavailable={environmentUnavailable}
                      isPreparingWorktree={false}
                      hasSendableContent={hasContent}
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
      {startFromOpen && project ? (
        <StartFromPickerDialog
          environmentId={project.environmentId}
          projectRef={scopeProjectRef(project.environmentId, project.id)}
          projectId={project.id}
          workspaceRoot={project.workspaceRoot}
          githubIssuesAvailable={isGitHubProject(project)}
          linkThreadRef={null}
          onPick={async (pick) => {
            setStartFrom(pick);
            return true;
          }}
          onOpen={(href) => void bridge?.submit({ type: "open", href }).catch(noop)}
          onClose={() => {
            setStartFromOpen(false);
            inputRef.current?.focus();
          }}
        />
      ) : null}
      {project ? (
        <ComposerAttachRedirect.Provider
          value={(attachment) => {
            setAttachments((current) => [...current, { id: randomUUID(), attachment }]);
            inputRef.current?.focus();
          }}
        >
          <ThreadAttachPickerHost />
          <LinearIssuePickerHost />
          <NotionPagePickerHost />
          <GranolaNotePickerHost />
          <SlackMessagePickerHost />
          <DiscordMessagePickerHost />
          <GitHubIssuePickerHost
            checkout={{
              projectRef: scopeProjectRef(project.environmentId, project.id),
              cwd: project.workspaceRoot,
            }}
          />
          <PullRequestAttachPickerHost
            environmentId={project.environmentId}
            projectId={project.id}
          />
          <CheckoutAttachPickerHost />
          <RepositoryAttachPickerHost workspaceCwd={null} />
        </ComposerAttachRedirect.Provider>
      ) : null}
    </QuickMessageFrame>
  );
}
