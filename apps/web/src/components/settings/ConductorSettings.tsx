import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
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
import { setupProjectScript } from "@t3tools/shared/projectScripts";
import { msg, T, useGT } from "gt-react";
import { useRef, useState } from "react";

import { useConductorSettings } from "~/hooks/useConductorSettings";
import { m } from "~/i18n/messages";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  clearProjectFileQueryData,
  confirmProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
} from "../files/projectFilesQueryState";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * The project's Conductor settings (`.conductor/settings.toml` and the
 * uncommitted `settings.local.toml`), edited in place in the representative
 * checkout. The server applies them when it creates a worktree; see
 * `apps/server/src/project/ConductorWorkspace.ts`.
 */
export function ConductorSettings() {
  const { scope, target } = useSettingsScope();
  const member =
    (scope.kind === "project" || scope.kind === "checkout") && target?.projectId
      ? scope.members.find((candidate) => candidate.id === target.projectId)
      : undefined;
  if (!member) return null;
  const setupAction = setupProjectScript(target?.settings.defaultProjectScripts ?? []);
  return (
    <ConductorSettingsSection
      environmentId={member.environmentId}
      cwd={member.workspaceRoot}
      setupActionName={setupAction?.name ?? null}
    />
  );
}

function ConductorSettingsSection({
  environmentId,
  cwd,
  setupActionName,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  setupActionName: string | null;
}) {
  const gt = useGT();
  const [target, setTarget] = useState<ConductorEditTarget>("local");
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });

  const { files, worktreeInclude } = useConductorSettings(environmentId, cwd);

  const model = conductorEditModel({ files, worktreeInclude, target, setupActionName });
  const { targetPath, targetLabel, targetRaw } = model;

  // Saves run one at a time, each on top of the previous one's contents, so
  // editing a second field while the first is still writing loses nothing.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const save = (patch: ConductorSettingsPatch) => {
    const path = targetPath;
    const label = targetLabel;
    const fallbackRaw = targetRaw;
    saveQueue.current = saveQueue.current.then(async () => {
      const currentRaw =
        getOptimisticProjectFileQueryData(environmentId, cwd, path)?.contents ?? fallbackRaw;
      let contents: string;
      try {
        contents = updateConductorSettingsToml(currentRaw, patch);
      } catch {
        toastManager.add({
          type: "error",
          title: m(msg("Could not update {file}", { file: label })),
          description: m(msg("The file is not valid TOML. Fix it by hand first.")),
        });
        return;
      }
      setProjectFileQueryData(environmentId, cwd, path, contents);
      const result = await writeFile({
        environmentId,
        input: { cwd, relativePath: path, contents },
      });
      if (result._tag === "Success") {
        confirmProjectFileQueryData(environmentId, cwd, path, contents);
        return;
      }
      clearProjectFileQueryData(environmentId, cwd, path);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: m(msg("Could not save {file}", { file: label })),
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
    // A failed save must not stall the ones queued after it.
    saveQueue.current = saveQueue.current.catch((error: unknown) => {
      clearProjectFileQueryData(environmentId, cwd, path);
      toastManager.add({
        type: "error",
        title: m(msg("Could not save {file}", { file: label })),
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  const disabled = model.targetInvalid;

  const resetButton = (
    ariaLabel: string,
    field: ConductorEditField,
    patch: ConductorSettingsPatch,
  ) =>
    field.isSet ? (
      <SettingResetButton
        ariaLabel={ariaLabel}
        tooltip={gt("Remove from {file}", { file: targetLabel })}
        disabled={disabled}
        onClick={() => save(patch)}
      />
    ) : null;

  return (
    <SettingsSection id="project-conductor" title={gt("Conductor")}>
      <SettingsRow
        title={gt("Save changes to")}
        description={
          <T>
            New worktrees copy these files and run these scripts.{" "}
            <b className="font-medium">Only me</b> writes the uncommitted{" "}
            <code>.conductor/settings.local.toml</code>; <b className="font-medium">Repository</b>{" "}
            writes <code>.conductor/settings.toml</code> for everyone who clones it.
          </T>
        }
        control={
          <ToggleGroup
            aria-label={gt("Conductor settings file")}
            value={[target]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "local" || value === "shared") setTarget(value);
            }}
          >
            <Toggle value="local">
              <T>Only me</T>
            </Toggle>
            <Toggle value="shared">
              <T context="settings file shared through the repository">Repository</T>
            </Toggle>
          </ToggleGroup>
        }
      />
      {model.targetInvalid ? (
        <SettingsRow
          className="text-warning"
          title={gt("{file} is invalid", { file: targetLabel })}
          description={gt(
            "It is not valid TOML, so it is ignored and cannot be edited here. Fix it in an editor.",
          )}
        />
      ) : null}
      {model.otherInvalidFiles.map((path) => (
        <SettingsRow
          key={path}
          className="text-warning"
          title={gt("{file} is invalid", { file: path })}
          description={gt("It fails to parse, so new worktrees ignore it.")}
        />
      ))}

      <SettingsRow
        title={gt("Setup script")}
        description={gt("Runs in each new worktree after it is created.")}
        status={<FieldStatus field={model.setup} />}
        resetAction={resetButton(gt("Reset setup script to default"), model.setup, { setup: null })}
      >
        <ScriptField
          ariaLabel={gt("Setup script")}
          field={model.setup}
          disabled={disabled}
          onCommit={(next) => save({ setup: next })}
        />
      </SettingsRow>

      <SettingsRow
        title={gt("Archive script")}
        description={gt("Runs in a worktree just before T3 Code removes it.")}
        status={<FieldStatus field={model.archive} />}
        resetAction={resetButton(gt("Reset archive script to default"), model.archive, {
          archive: null,
        })}
      >
        <ScriptField
          ariaLabel={gt("Archive script")}
          field={model.archive}
          disabled={disabled}
          onCommit={(next) => save({ archive: next })}
        />
      </SettingsRow>

      <SettingsRow
        title={gt("Files to copy")}
        description={gt(
          "Gitignored files matching these patterns are copied from this checkout into each new worktree. Uses .gitignore syntax, one pattern per line.",
        )}
        status={<FieldStatus field={model.filesToCopy} />}
        resetAction={resetButton(gt("Reset files to copy to default"), model.filesToCopy, {
          fileIncludeGlobs: null,
        })}
      >
        <ScriptField
          ariaLabel={gt("Files to copy")}
          field={model.filesToCopy}
          disabled={disabled || model.filesToCopy.lockedByWorktreeInclude}
          onCommit={(next) => save({ fileIncludeGlobs: next })}
        />
      </SettingsRow>

      <SettingsRow
        title={gt("Environment variables")}
        description={
          <T>
            Passed to the setup, archive, and run scripts, one <code>KEY=value</code> per line,
            alongside CONDUCTOR_ROOT_PATH, CONDUCTOR_WORKSPACE_PATH, CONDUCTOR_PORT, and the other
            Conductor variables.
          </T>
        }
        status={<FieldStatus field={model.environment} />}
        resetAction={resetButton(gt("Reset environment variables to default"), model.environment, {
          environment: null,
        })}
      >
        <ScriptField
          ariaLabel={gt("Environment variables")}
          field={model.environment}
          disabled={disabled}
          onCommit={(next) => {
            const parsed = parseConductorEnvironmentLines(next);
            if (typeof parsed === "string") {
              toastManager.add({
                type: "error",
                title: m(msg("Environment variables not saved")),
                description: parsed,
              });
              return;
            }
            save({ environment: parsed });
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** Where a field's value comes from, as shown under its title. */
function FieldStatus({ field }: { field: ConductorEditField }) {
  if (field.statuses.length === 0) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {field.statuses.map((status) => (
        <span key={status.text} className={status.tone === "warning" ? "text-warning" : undefined}>
          {status.text}
        </span>
      ))}
    </span>
  );
}

/**
 * A monospace textarea that saves when it loses focus (or on Cmd/Ctrl+Enter),
 * so typing never writes the file on every keystroke.
 */
function ScriptField({
  ariaLabel,
  field,
  disabled,
  onCommit,
}: {
  ariaLabel: string;
  field: ConductorEditField;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const { value, placeholder } = field;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="pt-2 pb-3">
      <Textarea
        size="sm"
        variant="code"
        aria-label={ariaLabel}
        spellCheck={false}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setDraft(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft ?? value;
          setDraft(null);
          if (next.trim() !== value.trim()) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
