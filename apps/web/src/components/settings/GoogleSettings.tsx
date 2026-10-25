import { useAtomValue } from "@effect/atom-react";
import { GoogleIcon } from "../Icons";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  GOOGLE_REDIRECT_URI,
  type GoogleConnectionState,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { googleEnvironment } from "../../state/google";
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
 * Connects the selected environment's Google account. The account belongs to
 * the environment, so every client of that environment can attach files.
 */
export function GoogleSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The account belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("google")} icon={<GoogleIcon className="size-4" />}>
      {environmentId === null ? (
        <SettingsRow
          title="Google account"
          description="Connect to an environment to set up Google."
        />
      ) : (
        <GoogleIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
  );
}

function GoogleIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableGoogleIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return (
    <>
      <SettingsRow
        title="Enable Google integration"
        description="Attach Google Drive files and Calendar events. Turn off to keep pasted Google links as links without setup prompts. Your connected account is kept."
        control={
          <Switch
            aria-label="Enable Google integration"
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableGoogleIntegration: checked })}
          />
        }
      />
      {enabled ? <GoogleConnectionRows {...props} /> : null}
    </>
  );
}

function describeConnection(state: GoogleConnectionState | null): string {
  if (state === null) return "Reading Google status.";
  switch (state.phase) {
    case "connected":
      return state.account ? `Connected to ${state.account.email}.` : "Connected.";
    case "waiting":
      return "Approve T3 Code on Google's page in your browser.";
    case "failed":
      return state.message ?? "Google sign-in failed.";
    case "disconnected":
      return "Attach Google Drive files and Calendar events to messages as context for the agent.";
  }
}

function GoogleConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(
    googleEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const canOperate = useAtomValue(googleEnvironment.startLogin.permissionAtom(environmentId));
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(googleEnvironment.startLogin, commandOptions);
  const completeLogin = useAtomCommand(googleEnvironment.completeLogin, commandOptions);
  const cancelLogin = useAtomCommand(googleEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(googleEnvironment.disconnect, commandOptions);
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
    canOperate &&
    (clientSecret.length > 0
      ? clientId.length > 0
      : state?.configured === true && clientId === (state.clientId ?? ""));
  const flowId = state?.phase === "waiting" ? state.flowId : null;
  const authorizationUrl = state?.phase === "waiting" ? state.authorizationUrl : null;
  const pastedValue = pasted.flowId === flowId ? pasted.value : "";

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>) {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await request().finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Google request failed.");
      }
      return null;
    }
    return result.value;
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
    // it as a popup, so the web build relies on the Open Google button.
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
      `Disconnect Google from ${environmentLabel}? Pages already attached to messages stay as they are.`,
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;
  const signedOut = state?.phase === "disconnected" || state?.phase === "failed";
  const showCredentials = signedOut && (state.configured === false || editingCredentials);
  const fieldId = (name: string) => `google-${name}-${environmentId}`;

  return (
    <>
      <SettingsRow
        title="Google account"
        description={<span className={statusClass}>{status}</span>}
        control={
          state === null ? null : state.phase === "connected" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canOperate}
              onClick={confirmDisconnect}
            >
              Disconnect
            </Button>
          ) : state.phase === "waiting" ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {authorizationUrl ? (
                <>
                  <Button size="sm" onClick={() => openAuthorization(authorizationUrl)}>
                    Open Google
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => writeTextToClipboard(authorizationUrl, "Google sign-in link")}
                  >
                    Copy link
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !canOperate || flowId === null}
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
              {editingCredentials ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingCredentials(false);
                    setClientIdDraft(null);
                    setClientSecretDraft("");
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button size="sm" disabled={pending || !canConnect} onClick={connect}>
                {state.phase === "failed" ? "Reconnect Google" : "Connect Google"}
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
              Create a Google Cloud OAuth client for a Web application and enable the Drive, Docs,
              Sheets, Calendar and People APIs. Register this redirect URI, then add its client ID
              and secret. The secret stays on {environmentLabel}.{" "}
              <InlineButton
                render={
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                }
              >
                Create an OAuth client
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
                  value={state?.redirectUri ?? GOOGLE_REDIRECT_URI}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    writeTextToClipboard(state?.redirectUri ?? GOOGLE_REDIRECT_URI, "Redirect URI")
                  }
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
          </form>
        ) : null}
      </SettingsRow>
      {state?.phase === "waiting" ? (
        <SettingsRow
          title="Approving from another device?"
          description={`If the browser can't reach ${environmentLabel}, Google ends on a page that won't load. Paste that page's URL here.`}
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
                aria-label="Redirect URL from Google"
                placeholder="Full redirect URL from Google"
                value={pastedValue}
                onChange={(event) => setPasted({ flowId, value: event.target.value })}
              />
              <Button
                size="sm"
                type="submit"
                disabled={pending || !canOperate || !pastedValue.trim()}
              >
                Submit
              </Button>
            </form>
          }
        />
      ) : null}
    </>
  );
}
