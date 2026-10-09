import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  ProjectId,
  type SlackMentionTriggerSettings,
  AuthSettingsWriteScope,
  AuthOrchestrationOperateScope,
  SLACK_REDIRECT_URI,
  slackAppManifest,
  type SlackConnectionState,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Slack account. Like Linear, the account belongs to the
 * environment, so every client of that environment can attach messages. Each workspace signs in
 * through its own Slack app, made from the manifest this section copies.
 */
export function SlackSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The account belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("slack")}>
      {environmentId === null ? (
        <SettingsRow
          title="Slack account"
          description="Connect to an environment to set up Slack."
        />
      ) : (
        <SlackIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
  );
}

function SlackIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableSlackIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return (
    <>
      <SettingsRow
        title="Enable Slack integration"
        description="Attach Slack messages and threads. Turn off to keep pasted Slack links as links without setup prompts. Your connected account is kept."
        control={
          <Switch
            aria-label="Enable Slack integration"
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableSlackIntegration: checked })}
          />
        }
      />
      {enabled ? (
        <>
          <SlackConnectionRows {...props} />
          <SlackMentionTriggerRows environmentId={props.environmentId} />
        </>
      ) : null}
    </>
  );
}

function describeConnection(state: SlackConnectionState | null): string {
  if (state === null) return "Reading Slack status.";
  switch (state.phase) {
    case "connected":
      return state.account
        ? `Connected as ${state.account.userName} in ${state.account.teamName}. Reads as you; never posts.`
        : "Connected.";
    case "waiting":
      return "Approve T3 Code on Slack's page in your browser.";
    case "failed":
      return state.message ?? "Slack sign-in failed.";
    case "disconnected":
      return "Attach Slack messages and threads to messages as context for the agent.";
  }
}

function SlackConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(slackEnvironment.connection({ environmentId, input: {} }));
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(slackEnvironment.startLogin, commandOptions);
  const completeLogin = useAtomCommand(slackEnvironment.completeLogin, commandOptions);
  const cancelLogin = useAtomCommand(slackEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(slackEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Null until edited, so the field shows the client ID the server last signed in with.
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null);
  const [pasted, setPasted] = useState({ flowId: null as string | null, value: "" });
  const clientId = (clientIdDraft ?? state?.clientId ?? "").trim();
  const flowId = state?.phase === "waiting" ? state.flowId : null;
  const authorizationUrl = state?.phase === "waiting" ? state.authorizationUrl : null;
  const pastedValue = pasted.flowId === flowId ? pasted.value : "";

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>) {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Slack request failed.");
        }
        return null;
      }
      return result.value;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function openAuthorization(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError("Could not open the browser. Copy the link and open it yourself.");
    }
  }

  async function connect() {
    const next = await run(() =>
      startLogin({ environmentId, input: clientId.length > 0 ? { clientId } : {} }),
    );
    // Only the desktop shell can open a tab after an await; browsers block
    // it as a popup, so the web build relies on the Open Slack button.
    if (isElectron && next?.authorizationUrl) await openAuthorization(next.authorizationUrl);
  }

  async function submitPasted() {
    if (!flowId || !pastedValue.trim()) return;
    const accepted = await run(() =>
      completeLogin({ environmentId, input: { flowId, callbackUrl: pastedValue } }),
    );
    if (accepted) setPasted({ flowId: null, value: "" });
  }

  async function confirmDisconnect() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Disconnect Slack from ${environmentLabel}? Messages already attached stay as they are.`,
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;
  const signedOut = state?.phase === "disconnected" || state?.phase === "failed";

  return (
    <>
      <SettingsRow
        title="Slack account"
        description={<span className={statusClass}>{status}</span>}
        control={
          state === null ? null : state.phase === "connected" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={confirmDisconnect}>
              Disconnect
            </Button>
          ) : state.phase === "waiting" ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {authorizationUrl ? (
                <>
                  <Button size="sm" onClick={() => openAuthorization(authorizationUrl)}>
                    Open Slack
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => writeTextToClipboard(authorizationUrl, "Slack sign-in link")}
                  >
                    Copy link
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || flowId === null}
                onClick={() =>
                  flowId ? run(() => cancelLogin({ environmentId, input: { flowId } })) : undefined
                }
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={pending || clientId.length === 0} onClick={connect}>
              {state.phase === "failed" ? "Reconnect Slack" : "Connect Slack"}
            </Button>
          )
        }
      />
      {signedOut ? (
        <SettingsRow
          title="Slack app"
          description="Slack signs in through an app in your own workspace. At api.slack.com/apps, choose Create New App → From a manifest, paste the copied manifest, then enter the app's Client ID here."
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Input
                size="sm"
                aria-label="Slack app client ID"
                placeholder="Client ID, e.g. 1234567890.1234567890"
                className="min-w-0 flex-1 sm:w-64"
                value={clientIdDraft ?? state?.clientId ?? ""}
                onChange={(event) => setClientIdDraft(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => writeTextToClipboard(slackAppManifest(), "Slack app manifest")}
              >
                Copy manifest
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void ensureLocalApi().shell.openExternal("https://api.slack.com/apps")
                }
              >
                Create Slack app
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          }
        />
      ) : null}
      {state?.phase === "waiting" ? (
        <SettingsRow
          title="Approving from another device?"
          description={`If the browser can't reach ${environmentLabel}, Slack ends on a page that won't load. Paste that page's URL here.`}
          control={
            <form
              className="flex w-full gap-2 sm:w-80"
              onSubmit={(event) => {
                event.preventDefault();
                void submitPasted();
              }}
            >
              <Input
                size="sm"
                aria-label="Redirect URL from Slack"
                placeholder={`${SLACK_REDIRECT_URI}?code=…`}
                value={pastedValue}
                onChange={(event) => setPasted({ flowId, value: event.target.value })}
              />
              <Button size="sm" type="submit" disabled={pending || !pastedValue.trim()}>
                Submit
              </Button>
            </form>
          }
        />
      ) : null}
    </>
  );
}

/** The environment owns the trigger, including when clients disconnect. */
function SlackMentionTriggerRows({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const trigger = settings.slackMentionTrigger;
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const disabled = !canWrite || !canOperate;
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const project = projects.find((entry) => entry.id === trigger.projectId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const selection = resolveDefaultProviderModelSelection(
    providers,
    trigger.modelSelection ??
      resolveProjectSettings(settings, trigger.projectId ?? ProjectId.make("unselected"), project)
        .settings.defaultModelSelection,
  );
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const save = (patch: Partial<SlackMentionTriggerSettings>) =>
    updateSettings({ slackMentionTrigger: { ...trigger, ...patch } });
  return (
    <>
      <SettingsRow
        title="Start threads from Slack mentions"
        description="Poll once a minute for new @mentions of the connected account. Choose channels and a project first. Older mentions are ignored. Threads use the project's permission mode and run while this server is online."
        control={
          <Switch
            aria-label="Start threads from Slack mentions"
            checked={trigger.enabled}
            disabled={
              disabled ||
              trigger.projectId === null ||
              (trigger.channels.length === 0 && !trigger.includeDirectMessages)
            }
            onCheckedChange={(enabled) => save({ enabled })}
          />
        }
      />
      <SettingsRow
        title="Mention project"
        description="The project whose workspace receives the request."
        control={
          <Select
            value={trigger.projectId ?? "none"}
            onValueChange={(value) =>
              save({ projectId: value === null || value === "none" ? null : ProjectId.make(value) })
            }
          >
            <SelectTrigger disabled={disabled}>
              <SelectValue>{project?.title ?? "Choose project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="none">Choose project</SelectItem>
              {projects.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Mention channels"
        description="Comma-separated channel names or IDs. Only channels your account can read are included."
        control={
          <Input
            key={trigger.channels.join(",")}
            size="sm"
            aria-label="Mention channels"
            disabled={disabled}
            defaultValue={trigger.channels.join(", ")}
            onBlur={(event) =>
              save({
                channels: event.target.value
                  .split(",")
                  .map((name) => name.trim())
                  .filter(Boolean)
                  .slice(0, 100)
                  .map((name) => name.slice(0, 128)),
              })
            }
          />
        }
      />
      <SettingsRow
        title="Include direct messages"
        description="Also include @mentions in direct and group messages. Ordinary messages without an @mention do not start threads."
        control={
          <Switch
            aria-label="Include direct messages in mention trigger"
            disabled={disabled}
            checked={trigger.includeDirectMessages}
            onCheckedChange={(includeDirectMessages) => save({ includeDirectMessages })}
          />
        }
      />
      <SettingsRow
        title="Mention keyword"
        description="Optional word or phrase that must also appear in the mention."
        control={
          <Input
            key={trigger.keyword}
            size="sm"
            aria-label="Mention keyword"
            disabled={disabled}
            maxLength={64}
            defaultValue={trigger.keyword}
            onBlur={(event) => save({ keyword: event.target.value.trim() })}
          />
        }
      />
      <SettingsRow
        title="Mention prompt"
        description="Instructions sent with the Slack thread snapshot."
        control={
          <Textarea
            key={trigger.prompt}
            size="sm"
            aria-label="Mention prompt"
            disabled={disabled}
            maxLength={8000}
            defaultValue={trigger.prompt}
            onBlur={(event) => save({ prompt: event.target.value.trim() })}
          />
        }
      />
      <SettingsRow
        title="Mention model"
        description={
          trigger.modelSelection === null
            ? "Uses the project's default provider and model."
            : "Provider and model used for mention threads."
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            {selection ? (
              <ProviderModelPicker
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptions}
                disabled={disabled}
                onInstanceModelChange={(instanceId, model) =>
                  save({ modelSelection: createModelSelection(instanceId, model) })
                }
              />
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || trigger.modelSelection === null}
              onClick={() => save({ modelSelection: null })}
            >
              Use project default
            </Button>
          </div>
        }
      />
    </>
  );
}
