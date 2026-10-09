import { useNavigate } from "@tanstack/react-router";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import {
  parseWorktreeCleanupIgnoredNames,
  WORKTREE_CLEANUP_IGNORED_NAME_MAX_COUNT,
  WS_METHODS,
  type EnvironmentId,
  type ProviderInstanceId,
  type StorageCleanupSettings,
  type WorktreeCleanupRules,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { resolveWorktreeCleanupModelSelection } from "@t3tools/shared/serverSettings";
import { useRef, useState } from "react";

import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { ContextRepositoriesSection } from "./ContextRepositoriesSettings";
import { connectionAtomRuntime } from "../../connection/runtime";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

import { WorktreeInventorySection } from "./WorktreeInventory";

const IGNORED_NAME_ERROR =
  "Enter one file or directory name per line, up to 50. Names cannot include *, ?, or a path.";

const suggestIgnoredNames = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:suggest-worktree-cleanup-ignored-names",
  tag: WS_METHODS.serverSuggestWorktreeCleanupIgnoredNames,
});

function IgnoredNamesField({
  names,
  mixed,
  environments,
  onCommit,
}: {
  names: readonly string[];
  mixed: boolean;
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>;
  onCommit: (names: readonly string[]) => void;
}) {
  const savedText = mixed ? "" : names.join("\n");
  const [draft, setDraft] = useState(savedText);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestStatus, setSuggestStatus] = useState<string | null>(null);
  const suggest = useAtomCommand(suggestIgnoredNames, { reportFailure: false });

  const suggestFromProjects = async () => {
    setSuggesting(true);
    setSuggestStatus(null);
    const found = new Set<string>();
    let failed = 0;
    for (const environment of environments) {
      const result = await suggest({ environmentId: environment.environmentId, input: {} });
      if (result._tag !== "Success") {
        failed += 1;
        continue;
      }
      for (const name of result.value.names) found.add(name);
    }
    setSuggesting(false);
    if (found.size === 0) {
      setSuggestStatus(
        failed > 0
          ? "Could not look through projects."
          : "No extra ignored directories in your projects.",
      );
      return;
    }
    const suggested = [...found].slice(0, WORKTREE_CLEANUP_IGNORED_NAME_MAX_COUNT);
    setDraft(suggested.join("\n"));
    setDirty(false);
    setError(null);
    onCommit(suggested);
    setSuggestStatus(
      suggested.length === 1
        ? "Found 1 ignored directory that shows up in more than one project."
        : `Found ${suggested.length} ignored directories that show up in more than one project.`,
    );
  };

  return (
    <div className="max-w-md pb-3">
      <Textarea
        size="sm"
        value={draft}
        rows={3}
        aria-label="Ignored names that do not block worktree cleanup"
        aria-invalid={error !== null}
        placeholder={mixed ? "Mixed across selected machines" : "target"}
        onChange={(event) => {
          setDirty(true);
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (!dirty) return;
          const parsed = parseWorktreeCleanupIgnoredNames(draft);
          if (parsed === null) {
            setError(IGNORED_NAME_ERROR);
            return;
          }
          setDirty(false);
          if (!mixed && parsed.join("\n") === names.join("\n")) return;
          onCommit(parsed);
        }}
      />
      {error ? <p className="pt-1 text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={suggesting || environments.length === 0}
          onClick={() => void suggestFromProjects()}
        >
          {suggesting ? "Asking the model…" : "Suggest from projects"}
        </Button>
        {suggestStatus ? <p className="text-xs text-muted-foreground">{suggestStatus}</p> : null}
      </div>
    </div>
  );
}

function WorktreesDirectoryRow() {
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        "Folder where new worktrees are created, on any drive, such as D:\\worktrees or ~/worktrees. Existing worktrees stay where they are. Leave empty to use the T3 home folder."
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label="worktree location"
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label="Worktree location"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mixed ? "Mixed" : "Default"}
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

function IgnoredNamesModelControl() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const defaultModelSelection = resolveAppModelSelectionState(settings, textGenerationProviders);
  const usesDedicatedModel = settings.worktreeCleanupModelSelection !== null;
  const activeSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveWorktreeCleanupModelSelection(
        settings,
        textGenerationProviders,
      ),
    },
    textGenerationProviders,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings),
  );
  const canEnableDedicatedModel = instanceEntries.some(
    (entry) =>
      entry.instanceId === defaultModelSelection.instanceId && entry.enabled && entry.isAvailable,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  if (connectedEnvironments.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {usesDedicatedModel && !canEnableDedicatedModel ? (
        <span className="text-sm text-muted-foreground">
          No text generation providers available.
        </span>
      ) : null}
      {usesDedicatedModel && canEnableDedicatedModel ? (
        <ProviderModelPicker
          activeInstanceId={activeSelection.instanceId}
          model={activeSelection.model}
          lockedProvider={null}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
          triggerAriaLabel="Model for ignored-name suggestions"
          {...(environmentId
            ? {
                onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId, instanceId },
                  });
                },
              }
            : {})}
          getModelDisabledReason={modelDisabledReason}
          onInstanceModelChange={(instanceId, model) => {
            const reason = modelDisabledReason(instanceId, model);
            if (reason) {
              toastManager.add({
                type: "error",
                title: "Suggestion model not saved",
                description: reason,
              });
              return;
            }
            updateSettings({
              worktreeCleanupModelSelection: createModelSelection(instanceId, model),
            });
          }}
        />
      ) : null}
      <Switch
        checked={usesDedicatedModel}
        disabled={!usesDedicatedModel && !canEnableDedicatedModel}
        onCheckedChange={(checked) =>
          updateSettings({
            worktreeCleanupModelSelection: checked
              ? createModelSelection(
                  defaultModelSelection.instanceId,
                  defaultModelSelection.model,
                  defaultModelSelection.options,
                )
              : null,
          })
        }
        aria-label="Use a separate model for ignored-name suggestions"
      />
    </div>
  );
}

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const ignoredNamesSupported =
    !isProjectScope &&
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreeCleanupIgnoredNames === true,
    );
  const ignoredNamesText = settings.worktreeCleanupIgnoredNames.join("\n");
  const ignoredNamesMixed =
    ignoredNamesSupported &&
    targets.some(
      (entry) =>
        entry.settings.storageCleanup.worktreeCleanupIgnoredNames.join("\n") !== ignoredNamesText,
    );
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        Update the selected machines to configure project worktree cleanup.
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        Update the selected environments to use storage cleanup, or choose a machine that supports
        it.
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection id="storage-worktrees" title="Worktrees">
        {!isProjectScope && <WorktreesDirectoryRow />}
        {isProjectScope && (
          <SettingsRow
            title="Automatic worktree cleanup"
            description={
              mode === "off"
                ? "Keep this project's worktrees until you delete them manually."
                : mode === "custom"
                  ? "Use these rules for this project."
                  : "Use each machine's worktree cleanup settings."
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label="Automatic worktree cleanup">
                  <SelectValue>
                    {mixedModes
                      ? "Mixed"
                      : mode === "inherit"
                        ? "Inherit"
                        : mode === "off"
                          ? "Off"
                          : "Custom"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title="Delete worktrees with deleted threads"
              status={ruleStatus("worktreeOnDelete")}
              description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete worktrees with deleted threads"
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="Delete inactive worktrees"
              status={ruleStatus("worktreeAfterDays")}
              description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="Delete inactive worktrees"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <SettingsRow
              title="Delete merged worktrees"
              status={ruleStatus("worktreeOnMerge")}
              description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete merged worktrees"
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title="Delete unchanged worktrees"
              status={ruleStatus("worktreeUnchanged")}
              description="Remove worktrees with no commits beyond the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete unchanged worktrees"
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
            {ignoredNamesSupported && (
              <SettingsRow
                title="Model for suggestions"
                description="Chooses ignored directories from your projects. Off uses the environment's text generation model."
                serverScoped
                settingKeys={["worktreeCleanupModelSelection"]}
                control={<IgnoredNamesModelControl />}
              />
            )}
            {ignoredNamesSupported && (
              <SettingsRow
                title="Ignored names that do not block cleanup"
                status={ignoredNamesMixed ? "Mixed across selected machines" : undefined}
                description="Ignored files and directories with these names are removed with the worktree. Built-in caches, such as node_modules and __pycache__, always apply."
                serverScoped
              >
                <IgnoredNamesField
                  names={settings.worktreeCleanupIgnoredNames}
                  mixed={ignoredNamesMixed}
                  environments={connectedEnvironments}
                  onCommit={(worktreeCleanupIgnoredNames) =>
                    update({ worktreeCleanupIgnoredNames })
                  }
                />
              </SettingsRow>
            )}
          </>
        )}
      </SettingsSection>

      {isProjectScope && <ContextRepositoriesSection members={scope.members} />}
      {!isProjectScope && <WorktreeInventorySection />}

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title="Artifacts and logs">
          <SettingsRow
            title="Delete old browser artifacts"
            status={ruleStatus("browserArtifactsAfterDays")}
            description="Delete saved browser captures after this many days. Older capture links will no longer open."
            serverScoped
            control={
              <RetentionControl
                label="Delete old browser artifacts"
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title="Delete old rotated logs"
            status={ruleStatus("logsAfterDays")}
            description="Delete inactive rotated log files after this many days. Current logs are kept."
            serverScoped
            control={
              <RetentionControl
                label="Delete old rotated logs"
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}
