import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  NOTION_REDIRECT_URI,
  type NotionConnectionState,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { notionEnvironment } from "../../state/notion";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Notion account. The account belongs to
 * the environment, so every client of that environment can attach pages.
 */
export function NotionSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The account belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("notion")}>
      {environmentId === null ? (
        <SettingsRow
          title="Notion account"
          description="Connect to an environment to set up Notion."
        />
      ) : (
        <NotionIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
  );
}

function NotionIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableNotionIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return (
    <>
      <SettingsRow
        title="Enable Notion integration"
        description="Attach Notion pages. Turn off to keep pasted Notion links as links without setup prompts. Your connected account is kept."
        control={
          <Switch
            aria-label="Enable Notion integration"
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableNotionIntegration: checked })}
          />
        }
      />
      {enabled ? <NotionConnectionRows {...props} /> : null}
    </>
  );
}

function describeConnection(state: NotionConnectionState | null): string {
  if (state === null) return "Reading Notion status.";
  switch (state.phase) {
    case "connected":
      return state.account ? `Connected to ${state.account.workspaceName}.` : "Connected.";
    case "waiting":
      return "Approve T3 Code on Notion's page in your browser.";
    case "failed":
      return state.message ?? "Notion sign-in failed.";
    case "disconnected":
      return "Attach Notion pages to messages as context for the agent.";
  }
}

function NotionConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(
    notionEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(notionEnvironment.startLogin, commandOptions);
  const completeLogin = useAtomCommand(notionEnvironment.completeLogin, commandOptions);
  const cancelLogin = useAtomCommand(notionEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(notionEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Null until edited, so the field shows the client ID the server last signed in with.
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null);
  const [clientSecretDraft, setClientSecretDraft] = useState("");
  // Saved credentials stay out of the way until the user asks to change them.
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [pasted, setPasted] = useState({ flowId: null as string | null, value: "" });
  const clientId = (clientIdDraft ?? state?.clientId ?? "").trim();
  const clientSecret = clientSecretDraft.trim();
  // A new secret is sent with the client ID; otherwise the server reuses the
  // credentials it has, which only fit the client ID it reports.
  const canConnect =
    clientSecret.length > 0
      ? clientId.length > 0
      : state?.configured === true && clientId === (state.clientId ?? "");
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
          setError(failure instanceof Error ? failure.message : "Notion request failed.");
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
      startLogin({
        environmentId,
        input: clientSecret.length > 0 ? { credentials: { clientId, clientSecret } } : {},
      }),
    );
    if (next) {
      setClientSecretDraft("");
      setEditingCredentials(false);
    }
    // Only the desktop shell can open a tab after an await; browsers block
    // it as a popup, so the web build relies on the Open Notion button.
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
      `Disconnect Notion from ${environmentLabel}? Pages already attached to messages stay as they are.`,
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;
  const signedOut = state?.phase === "disconnected" || state?.phase === "failed";
  const showCredentials = signedOut && (state.configured === false || editingCredentials);
  const fieldId = (name: string) => `notion-${name}-${environmentId}`;

  return (
    <>
      <SettingsRow
        title="Notion account"
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
                    Open Notion
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => writeTextToClipboard(authorizationUrl, "Notion sign-in link")}
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
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {state.configured && !editingCredentials ? (
                <Button size="sm" variant="ghost" onClick={() => setEditingCredentials(true)}>
                  Change credentials
                </Button>
              ) : null}
              <Button size="sm" disabled={pending || !canConnect} onClick={connect}>
                {state.phase === "failed" ? "Reconnect Notion" : "Connect Notion"}
              </Button>
            </div>
          )
        }
      >
        {showCredentials ? (
          <form
            className="mt-3 grid gap-3 border-t pt-3 pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canConnect) void connect();
            }}
          >
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Create an OAuth connection in Notion with this redirect URI, then add its client ID
              and secret. The secret stays on {environmentLabel}.{" "}
              <InlineButton
                render={
                  <a
                    href="https://www.notion.so/profile/integrations"
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                }
              >
                Create a connection
                <ExternalLinkIcon aria-hidden className="size-3" />
              </InlineButton>
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor={fieldId("redirect-uri")}>Redirect URI</Label>
              <div className="flex gap-2">
                <Input
                  id={fieldId("redirect-uri")}
                  size="sm"
                  readOnly
                  value={NOTION_REDIRECT_URI}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => writeTextToClipboard(NOTION_REDIRECT_URI, "Redirect URI")}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={fieldId("client-id")}>Client ID</Label>
                <Input
                  id={fieldId("client-id")}
                  size="sm"
                  autoComplete="off"
                  value={clientIdDraft ?? state?.clientId ?? ""}
                  onChange={(event) => setClientIdDraft(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={fieldId("client-secret")}>Client secret</Label>
                <Input
                  id={fieldId("client-secret")}
                  size="sm"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    state?.configured ? "Saved, enter a new one to replace it" : undefined
                  }
                  value={clientSecretDraft}
                  onChange={(event) => setClientSecretDraft(event.target.value)}
                />
              </div>
            </div>
            {editingCredentials ? (
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEditingCredentials(false);
                    setClientIdDraft(null);
                    setClientSecretDraft("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </SettingsRow>
      {state?.phase === "waiting" ? (
        <SettingsRow
          title="Approving from another device?"
          description={`If the browser can't reach ${environmentLabel}, Notion ends on a page that won't load. Paste that page's URL here.`}
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
                aria-label="Redirect URL from Notion"
                placeholder={`${NOTION_REDIRECT_URI}?code=…`}
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
