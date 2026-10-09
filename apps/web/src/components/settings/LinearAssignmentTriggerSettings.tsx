import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type LinearAssignmentTrigger,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { linearEnvironment } from "../../state/linear";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow } from "./settingsLayout";
import { scheduledTaskDefaultModel } from "./scheduledTasksSettings.logic";
import { searchableSetting } from "./settingsSearch";

const ANY_TEAM = "__any__";

/**
 * Rules that start a thread when a Linear issue is newly assigned to the connected account.
 * Stored in environment settings; the server polls Linear and starts the threads.
 */
export function LinearAssignmentTriggerRows({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  /** Rules stay listed while disconnected so they can still be removed; they do nothing then. */
  readonly connected: boolean;
}) {
  const rules = useEnvironmentSettings(
    environmentId,
    (settings) => settings.linearAssignmentTriggers,
  );
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const projects = useProjects();
  const filterOptions = useEnvironmentQuery(
    connected ? linearEnvironment.filterOptions({ environmentId, input: {} }) : null,
  ).data;
  // `null` is closed, `"new"` adds a rule, otherwise the rule being edited.
  const [editing, setEditing] = useState<LinearAssignmentTrigger | "new" | null>(null);

  const save = (next: ReadonlyArray<LinearAssignmentTrigger>) =>
    updateSettings({ linearAssignmentTriggers: next });

  return (
    <>
      <SettingsRow
        {...searchableSetting("linear-assignment-triggers")}
        title="Start threads from assignments"
        description="When an issue is newly assigned to you, start a thread for it. Issues already assigned when you add a rule are skipped. Checks every 2 minutes."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!canOperate || !connected}
            onClick={() => setEditing("new")}
          >
            <PlusIcon />
            Add rule
          </Button>
        }
      />
      {rules.map((rule) => {
        const project = projects.find(
          (entry) => entry.environmentId === environmentId && entry.id === rule.projectId,
        );
        const team = filterOptions?.teams.find((entry) => entry.id === rule.teamId);
        const filters = [
          rule.teamId === null ? "Any team" : (team?.name ?? "Unknown team"),
          rule.labelName === null ? "any label" : `label “${rule.labelName}”`,
        ].join(", ");
        return (
          <SettingsRow
            key={rule.id}
            title={project?.title ?? "Missing project"}
            description={`${filters} · ${rule.modelSelection.model}`}
            control={
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit rule"
                  disabled={!canOperate}
                  onClick={() => setEditing(rule)}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove rule"
                  disabled={!canOperate}
                  onClick={() => save(rules.filter((entry) => entry.id !== rule.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            }
          />
        );
      })}
      {editing !== null ? (
        <AssignmentTriggerDialog
          environmentId={environmentId}
          rule={editing === "new" ? null : editing}
          teams={filterOptions?.teams ?? []}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            save(
              rules.some((entry) => entry.id === rule.id)
                ? rules.map((entry) => (entry.id === rule.id ? rule : entry))
                : [...rules, rule],
            );
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function AssignmentTriggerDialog({
  environmentId,
  rule,
  teams,
  onClose,
  onSave,
}: {
  readonly environmentId: EnvironmentId;
  readonly rule: LinearAssignmentTrigger | null;
  readonly teams: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onClose: () => void;
  readonly onSave: (rule: LinearAssignmentTrigger) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const [projectId, setProjectId] = useState<string>(rule?.projectId ?? projects[0]?.id ?? "");
  const [teamId, setTeamId] = useState<string>(rule?.teamId ?? ANY_TEAM);
  const [labelName, setLabelName] = useState(rule?.labelName ?? "");
  const [prompt, setPrompt] = useState(rule?.prompt ?? "");
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(
    rule?.modelSelection ?? null,
  );
  const project = projects.find((entry) => entry.id === projectId);
  const activeSelection =
    modelSelection ?? scheduledTaskDefaultModel(settings, project ?? null, instanceEntries);
  const activeInstanceId =
    activeSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = activeSelection?.model ?? "";
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers, activeInstanceId, activeModel),
    [settings, providers, activeInstanceId, activeModel],
  );
  const canSave = project !== undefined && activeSelection !== null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {rule === null ? "New assignment rule" : "Edit assignment rule"}
          </DialogTitle>
          <DialogDescription>
            Each matching issue newly assigned to you starts one thread in a new worktree, with the
            issue attached and linked.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-5">
            <Field label="Project" htmlFor="linear-trigger-project">
              <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
                <SelectTrigger size="sm" id="linear-trigger-project">
                  <SelectValue placeholder="Select a project">{project?.title}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Linear team" htmlFor="linear-trigger-team">
                <Select value={teamId} onValueChange={(value) => setTeamId(value ?? ANY_TEAM)}>
                  <SelectTrigger size="sm" id="linear-trigger-team">
                    <SelectValue>
                      {teamId === ANY_TEAM
                        ? "Any team"
                        : (teams.find((team) => team.id === teamId)?.name ?? "Unknown team")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ANY_TEAM}>Any team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field label="Label" hint="Optional" htmlFor="linear-trigger-label">
                <Input
                  id="linear-trigger-label"
                  size="sm"
                  placeholder="Any label"
                  value={labelName}
                  onChange={(event) => setLabelName(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Prompt" hint="Optional" htmlFor="linear-trigger-prompt">
              <Textarea
                id="linear-trigger-prompt"
                className="max-h-64 overflow-y-auto"
                placeholder="This Linear issue was just assigned to me. Work on it."
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
            <Field label="Model">
              <ProviderModelPicker
                activeInstanceId={activeInstanceId}
                model={activeModel}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                isComposerOwned={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onInstanceModelChange={(instanceId, model) =>
                  setModelSelection(
                    rule?.modelSelection.instanceId === instanceId &&
                      rule.modelSelection.model === model
                      ? rule.modelSelection
                      : { instanceId, model },
                  )
                }
              />
            </Field>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" variant="ghost" />}>Cancel</DialogClose>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave({
                id: rule?.id ?? randomUUID(),
                projectId: project.id as ProjectId,
                teamId: teamId === ANY_TEAM ? null : teamId,
                labelName: labelName.trim() || null,
                prompt: prompt.trim() || null,
                modelSelection: activeSelection,
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline justify-between" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? (
          <span className="font-normal text-2xs text-muted-foreground/80">{hint}</span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}
