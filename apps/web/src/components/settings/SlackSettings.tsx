import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  SLACK_REDIRECT_URI,
  slackAppManifest,
  type SlackConnectionState,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
        <SlackConnectionRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
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
