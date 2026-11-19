import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  ProjectId,
  type DiscordMentionTriggerSettings,
  AuthSettingsWriteScope,
  AuthOrchestrationOperateScope,
  discordBotInviteUrl,
  type DiscordConnectionState,
  type DiscordServer,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { msg, T, useGT, useMessages } from "gt-react";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { discordEnvironment } from "../../state/discord";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { m, type MessageResolver } from "../../i18n/messages";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Discord bot. Discord gives user sign-in no access to
 * messages, so the environment reads as a bot the user creates and adds to their servers. Like
 * Slack, the connection belongs to the environment, so every client of it can attach messages.
 */
export function DiscordSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  // The bot belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("discord")}>
      {environmentId === null ? (
        <SettingsRow
          title={gt("Discord bot")}
          description={gt("Connect to an environment to set up Discord.")}
        />
      ) : (
        <DiscordIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? gt("this environment")}
        />
      )}
    </SettingsSection>
  );
}

function DiscordIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableDiscordIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const gt = useGT();
  return (
    <>
      <SettingsRow
        title={gt("Enable Discord integration")}
        description={gt(
          "Attach Discord messages and threads. Turn off to keep pasted Discord links as links without setup prompts. Your connected bot is kept.",
        )}
        control={
          <Switch
            aria-label={gt("Enable Discord integration")}
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableDiscordIntegration: checked })}
          />
        }
      />
      {enabled ? (
        <>
          <DiscordConnectionRows {...props} />
          <DiscordMentionTriggerRows environmentId={props.environmentId} />
        </>
      ) : null}
    </>
  );
}

function describeConnection(
  state: DiscordConnectionState | null,
  resolve: MessageResolver = m,
): string {
  if (state === null) return resolve(msg("Reading Discord status."));
  switch (state.phase) {
    case "connected":
      return state.account
        ? resolve(
            msg("Connected as {name}. Reads servers the bot is in; never posts.", {
              name: state.account.botName,
            }),
          )
        : resolve(msg("Connected."));
    case "failed":
      return state.message ?? resolve(msg("Discord rejected the bot token."));
    case "disconnected":
      return resolve(
        msg("Attach Discord messages and threads to messages as context for the agent."),
      );
  }
}

function DiscordConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(
    discordEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const connect = useAtomCommand(discordEnvironment.connect, commandOptions);
  const disconnect = useAtomCommand(discordEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const gt = useGT();
  const messages = useMessages();

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>) {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    // Atom commands settle to a result instead of rejecting.
    const result = await request();
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : m(msg("Discord request failed.")));
      }
      return null;
    }
    return { value: result.value };
  }

  async function submitToken() {
    const token = botToken.trim();
    if (!token) return;
    const accepted = await run(() => connect({ environmentId, input: { botToken: token } }));
    if (accepted) setBotToken("");
  }

  async function confirmDisconnect() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      m(
        msg("Disconnect Discord from {environment}? Messages already attached stay as they are.", {
          environment: environmentLabel,
        }),
      ),
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state, messages);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;
  const signedOut = state?.phase === "disconnected" || state?.phase === "failed";
  const applicationId = state?.phase === "connected" ? state.account?.applicationId : undefined;

  return (
    <>
      <SettingsRow
        title={gt("Discord bot")}
        description={<span className={statusClass}>{status}</span>}
        control={
          state?.phase === "connected" ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {applicationId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void ensureLocalApi().shell.openExternal(discordBotInviteUrl(applicationId))
                  }
                >
                  <T>Add bot to a server</T>
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={pending} onClick={confirmDisconnect}>
                <T>Disconnect</T>
              </Button>
            </div>
          ) : null
        }
      />
      {state?.phase === "connected" ? <DiscordServersRow environmentId={environmentId} /> : null}
      {signedOut ? (
        <SettingsRow
          title={gt("Bot token")}
          description={gt(
            "Create an application at discord.com/developers/applications. Under Bot, reset and copy the token, turn on Message Content Intent, and paste the token here. Then add the bot to each server to read.",
          )}
          control={
            <form
              className="flex w-full flex-wrap gap-2 sm:w-auto"
              onSubmit={(event) => {
                event.preventDefault();
                void submitToken();
              }}
            >
              <Input
                size="sm"
                type="password"
                autoComplete="off"
                aria-label={gt("Discord bot token")}
                placeholder={gt("Bot token")}
                className="min-w-0 flex-1 sm:w-64"
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
              />
              <Button size="sm" type="submit" disabled={pending || botToken.trim().length === 0}>
                {state?.phase === "failed" ? <T>Reconnect Discord</T> : <T>Connect Discord</T>}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() =>
                  void ensureLocalApi().shell.openExternal(
                    "https://discord.com/developers/applications",
                  )
                }
              >
                <T>Create Discord app</T>
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </form>
          }
        />
      ) : null}
    </>
  );
}

/**
 * The servers the bot can read. Discord tells a bot nothing when someone adds it, so the list
 * re-reads when the window regains focus, as it does after approving an invite in the browser.
 */
function DiscordServersRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const servers = useEnvironmentQuery(discordEnvironment.servers({ environmentId, input: {} }));
  const leaveServer = useAtomCommand(discordEnvironment.leaveServer, { reportFailure: false });
  const canLeave = useAtomValue(discordEnvironment.leaveServer.permissionAtom(environmentId));
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = servers;
  const gt = useGT();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window focus listener re-reads the servers after an invite is approved in the browser
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  async function confirmLeave(server: DiscordServer) {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      m(
        msg(
          "Remove the bot from {server}? T3 Code can't read it again until you add the bot back.",
          { server: server.name },
        ),
      ),
    );
    if (!confirmed) return;
    setLeaving(server.id);
    setError(null);
    const result = await leaveServer({ environmentId, input: { guildId: server.id } });
    setLeaving(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : m(msg("Could not remove the bot.")));
    }
    refresh();
  }

  const list = servers.data?.servers;
  const description =
    error ??
    (servers.error
      ? gt("Could not read the bot's servers.")
      : list === undefined
        ? gt("Reading the bot's servers.")
        : list.length === 0
          ? gt("The bot isn't in any server yet. Add it to a server to attach its messages.")
          : gt(
              "{count, plural, one {The bot can read 1 server.} other {The bot can read {count} servers.}}",
              {
                count: list.length,
              },
            ));

  return (
    <SettingsRow
      title={gt("Servers")}
      description={
        <span className={error !== null || servers.error ? "text-destructive" : undefined}>
          {description}
        </span>
      }
      control={
        <Button size="sm" variant="outline" disabled={servers.isPending} onClick={refresh}>
          <T>Refresh</T>
        </Button>
      }
    >
      {list !== undefined && list.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((server) => (
            <li key={server.id} className="flex items-center gap-3">
              {server.iconUrl ? (
                <img src={server.iconUrl} alt="" className="size-6 shrink-0 rounded-full" />
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  {server.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{server.name}</span>
              {canLeave ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={leaving !== null}
                  onClick={() => void confirmLeave(server)}
                >
                  {leaving === server.id ? (
                    <T>Removing…</T>
                  ) : (
                    <T context="verb, removes the bot from a server">Remove</T>
                  )}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsRow>
  );
}

/** The environment owns the trigger, including when clients disconnect. */
function DiscordMentionTriggerRows({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const trigger = settings.discordMentionTrigger;
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
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      trigger.projectId ?? null,
    ),
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const save = (patch: Partial<DiscordMentionTriggerSettings>) =>
    updateSettings({ discordMentionTrigger: { ...trigger, ...patch } });
  const gt = useGT();
  return (
    <>
      <SettingsRow
        title={gt("Start threads from Discord mentions")}
        description={gt(
          "Poll once a minute for new @mentions of the bot or the user ID below. Choose a project first. Older mentions are ignored. Threads use the project's permission mode and run while this server is online.",
        )}
        control={
          <Switch
            aria-label={gt("Start threads from Discord mentions")}
            checked={trigger.enabled}
            disabled={disabled || trigger.projectId === null}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        }
      />
      <SettingsRow
        title={gt("Mention project")}
        description={gt("The project whose workspace receives the request.")}
        control={
          <Select
            value={trigger.projectId ?? "none"}
            onValueChange={(value) =>
              save({ projectId: value === null || value === "none" ? null : ProjectId.make(value) })
            }
          >
            <SelectTrigger disabled={disabled}>
              <SelectValue>{project?.title ?? gt("Choose project")}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="none">
                <T>Choose project</T>
              </SelectItem>
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
        title={gt("Mention channels")}
        description={gt(
          "Comma-separated channel names or IDs. Leave empty to watch every channel the bot can read.",
        )}
        control={
          <Input
            key={trigger.channels.join(",")}
            size="sm"
            aria-label={gt("Mention channels")}
            disabled={disabled}
            placeholder={gt("All channels")}
            defaultValue={trigger.channels.join(", ")}
            onBlur={(event) =>
              save({
                channels: event.target.value
                  .split(",")
                  .map((name) => name.trim().replace(/^#/, ""))
                  .filter(Boolean)
                  .slice(0, 100)
                  .map((name) => name.slice(0, 128)),
              })
            }
          />
        }
      />
      <SettingsRow
        title={gt("Discord user ID to watch")}
        description={gt(
          "Optional. Start threads from mentions of this user instead of the bot. In Discord, turn on Developer Mode, then right-click a user and choose Copy User ID.",
        )}
        control={
          <Input
            key={trigger.mentionUserId}
            size="sm"
            aria-label={gt("Discord user ID to watch")}
            disabled={disabled}
            inputMode="numeric"
            maxLength={32}
            placeholder={gt("The bot")}
            defaultValue={trigger.mentionUserId}
            onBlur={(event) => save({ mentionUserId: event.target.value.trim() })}
          />
        }
      />
      <SettingsRow
        title={gt("Mention keyword")}
        description={gt("Optional word or phrase that must also appear in the mention.")}
        control={
          <Input
            key={trigger.keyword}
            size="sm"
            aria-label={gt("Mention keyword")}
            disabled={disabled}
            maxLength={64}
            defaultValue={trigger.keyword}
            onBlur={(event) => save({ keyword: event.target.value.trim() })}
          />
        }
      />
      <SettingsRow
        title={gt("Mention prompt")}
        description={gt("Instructions sent with the Discord thread snapshot.")}
        control={
          <Textarea
            key={trigger.prompt}
            size="sm"
            aria-label={gt("Mention prompt")}
            disabled={disabled}
            maxLength={8000}
            defaultValue={trigger.prompt}
            onBlur={(event) => save({ prompt: event.target.value.trim() })}
          />
        }
      />
      <SettingsRow
        title={gt("Mention model")}
        description={
          trigger.modelSelection === null
            ? gt("Uses the project's default provider and model.")
            : gt("Provider and model used for mention threads.")
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            {selection ? (
              <ProviderModelPicker
                environmentId={environmentId}
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
              <T>Use project default</T>
            </Button>
          </div>
        }
      />
    </>
  );
}
