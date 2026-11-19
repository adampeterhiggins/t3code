import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import {
  updateConductorSettingsToml,
  type ConductorSettingsPatch,
} from "@t3tools/shared/conductorSettings";
import {
  conductorEditModel,
  parseConductorEnvironmentLines,
  type ConductorEditField,
  type ConductorEditTarget,
} from "@t3tools/shared/conductorSettingsEditor";
import { resolveProjectScripts, setupProjectScript } from "@t3tools/shared/projectScripts";
import { msg, T, useGT, useMessages, Var } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { projectEnvironment } from "../../../state/projects";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useConductorSettings } from "../../projects/useConductorSettings";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsSection } from "./SettingsSection";

const TARGET_OPTIONS = [
  { value: "local", label: msg("Only me") },
  { value: "shared", label: msg("Repository", { $context: "settings stored in the repository" }) },
] as const satisfies ReadonlyArray<{ value: ConductorEditTarget; label: string }>;

/**
 * The project's Conductor settings, edited in the checkout on `project`'s
 * environment: the same fields and files as the web settings page, built on
 * the shared `conductorEditModel`.
 */
export function SettingsConductorSection(props: {
  readonly project: EnvironmentProject;
  readonly environment: SettingsTarget | undefined;
}) {
  const { project } = props;
  const gt = useGT();
  const messages = useMessages();
  const targetOptions = TARGET_OPTIONS.map((option) => ({
    value: option.value,
    label: messages(option.label),
  }));
  const [target, setTarget] = useState<ConductorEditTarget>("local");
  const conductor = useConductorSettings(project.environmentId, project.workspaceRoot);
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const setupAction = setupProjectScript(
    resolveProjectScripts(
      props.environment?.serverConfig.settings ?? DEFAULT_SERVER_SETTINGS,
      project,
    ),
  );
  const model = conductorEditModel({
    files: conductor.files,
    worktreeInclude: conductor.worktreeInclude,
    target,
    setupActionName: setupAction?.name ?? null,
  });

  // Saves run one at a time, each on top of the last one written, so a
  // second edit made while the first is still saving is not lost.
  const lastWritten = useRef<{ path: string; contents: string } | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  // Once the re-read file shows our last write, it is the source again, so a
  // later edit from another client is not overwritten from a stale copy.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the pending-write ref once the server's re-read file catches up; a ref can't be cleared during render
  useEffect(() => {
    if (lastWritten.current?.contents === model.targetRaw) lastWritten.current = null;
  }, [model.targetRaw]);
  const save = (patch: ConductorSettingsPatch) => {
    const path = model.targetPath;
    const label = model.targetLabel;
    const fallbackRaw = model.targetRaw;
    saveQueue.current = saveQueue.current
      .then(async () => {
        const currentRaw =
          lastWritten.current?.path === path ? lastWritten.current.contents : fallbackRaw;
        let contents: string;
        try {
          contents = updateConductorSettingsToml(currentRaw, patch);
        } catch {
          Alert.alert(
            gt("Could not update {file}", { file: label }),
            gt("The file is not valid TOML. Fix it by hand first."),
          );
          return;
        }
        const result = await writeFile({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot, relativePath: path, contents },
        });
        if (result._tag === "Success") {
          lastWritten.current = { path, contents };
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Alert.alert(
            gt("Could not save {file}", { file: label }),
            error instanceof Error ? error.message : undefined,
          );
        }
        conductor.refresh();
      })
      // A failed save must not stall the ones queued after it.
      .catch((error: unknown) => {
        Alert.alert(
          gt("Could not save {file}", { file: label }),
          error instanceof Error ? error.message : undefined,
        );
      });
  };
  const disabled = model.targetInvalid;

  return (
    // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
    <SettingsSection title="Conductor">
      <View className="gap-3 p-4">
        <Text className="text-sm leading-normal text-foreground-muted">
          <T>
            New worktrees copy these files and run these scripts, as Conductor does. Only me writes
            the uncommitted .conductor/settings.local.toml; Repository writes
            .conductor/settings.toml for everyone who clones it.
          </T>
        </Text>
        <SegmentedControl
          options={targetOptions}
          selected={target}
          onSelect={(value) => {
            lastWritten.current = null;
            setTarget(value);
          }}
        />
        {model.targetInvalid ? (
          <Text className="text-sm text-warning">
            <T>
              <Var>{model.targetLabel}</Var> is not valid TOML, so it is ignored and cannot be
              edited here.
            </T>
          </Text>
        ) : null}
        {model.otherInvalidFiles.map((path) => (
          <Text key={path} className="text-sm text-warning">
            <T>
              <Var>{path}</Var> fails to parse, so new worktrees ignore it.
            </T>
          </Text>
        ))}
      </View>
      <ConductorField
        title={gt("Setup script")}
        description={gt("Runs in each new worktree after it is created.")}
        resetLabel={gt("Remove setup script from {file}", { file: model.targetLabel })}
        field={model.setup}
        disabled={disabled}
        onCommit={(next) => save({ setup: next })}
        onReset={() => save({ setup: null })}
      />
      <ConductorField
        title={gt("Archive script")}
        description={gt("Runs in a worktree just before T3 Code removes it.")}
        resetLabel={gt("Remove archive script from {file}", { file: model.targetLabel })}
        field={model.archive}
        disabled={disabled}
        onCommit={(next) => save({ archive: next })}
        onReset={() => save({ archive: null })}
      />
      <ConductorField
        title={gt("Files to copy")}
        description={gt(
          "Gitignored files matching these patterns are copied from the checkout into each new worktree. One .gitignore pattern per line.",
        )}
        resetLabel={gt("Remove files to copy from {file}", { file: model.targetLabel })}
        field={model.filesToCopy}
        disabled={disabled || model.filesToCopy.lockedByWorktreeInclude}
        onCommit={(next) => save({ fileIncludeGlobs: next })}
        onReset={() => save({ fileIncludeGlobs: null })}
      />
      <ConductorField
        title={gt("Environment variables")}
        description={gt("Passed to the setup, archive, and run scripts, one KEY=value per line.")}
        resetLabel={gt("Remove environment variables from {file}", { file: model.targetLabel })}
        field={model.environment}
        disabled={disabled}
        onCommit={(next) => {
          const parsed = parseConductorEnvironmentLines(next);
          if (typeof parsed === "string") {
            Alert.alert(gt("Environment variables not saved"), parsed);
            return;
          }
          save({ environment: parsed });
        }}
        onReset={() => save({ environment: null })}
      />
    </SettingsSection>
  );
}

/** A multiline command field that saves when editing ends, not per keystroke. */
function ConductorField(props: {
  readonly title: string;
  readonly description: string;
  readonly resetLabel: string;
  readonly field: ConductorEditField;
  readonly disabled: boolean;
  readonly onCommit: (next: string) => void;
  readonly onReset: () => void;
}) {
  const { field } = props;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View className="gap-2 border-t border-border-subtle p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-base font-t3-medium text-foreground">{props.title}</Text>
        {field.isSet && !props.disabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.resetLabel}
            onPress={props.onReset}
            className="rounded-full bg-subtle-strong px-3 py-1 active:opacity-70"
          >
            <Text className="text-sm font-t3-medium text-foreground">
              <T>Reset</T>
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="text-sm leading-normal text-foreground-muted">{props.description}</Text>
      {field.statuses.map((status) => (
        <Text
          key={status.text}
          className={
            status.tone === "warning" ? "text-sm text-warning" : "text-sm text-foreground-muted"
          }
        >
          {status.text}
        </Text>
      ))}
      <AppTextInput
        accessibilityLabel={props.title}
        className="min-h-20 rounded-xl border-continuous bg-card px-3 py-2 font-mono text-sm text-foreground"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
        editable={!props.disabled}
        value={draft ?? field.value}
        placeholder={field.placeholder}
        onFocus={() => setDraft(field.value)}
        onChangeText={setDraft}
        onEndEditing={() => {
          const next = draft ?? field.value;
          setDraft(null);
          if (next.trim() !== field.value.trim()) props.onCommit(next);
        }}
      />
    </View>
  );
}
