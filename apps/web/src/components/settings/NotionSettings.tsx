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
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { notionEnvironment } from "../../state/notion";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
        <NotionConnectionRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
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
    if (next) setClientSecretDraft("");
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
            <Button size="sm" disabled={pending || !canConnect} onClick={connect}>
              {state.phase === "failed" ? "Reconnect Notion" : "Connect Notion"}
            </Button>
          )
        }
      />
      {signedOut ? (
        <SettingsRow
          title="Notion connection"
          description={`Notion signs in through an OAuth connection you create. Choose OAuth, register ${NOTION_REDIRECT_URI} as its redirect URI, then enter its client ID and secret here. The secret stays on ${environmentLabel}.`}
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Input
                size="sm"
                aria-label="Notion client ID"
                placeholder="Client ID"
                className="min-w-0 flex-1 sm:w-64"
                value={clientIdDraft ?? state?.clientId ?? ""}
                onChange={(event) => setClientIdDraft(event.target.value)}
              />
              <Input
                size="sm"
                type="password"
                autoComplete="off"
                aria-label="Notion client secret"
                placeholder={state?.configured ? "Client secret (saved)" : "Client secret"}
                className="min-w-0 flex-1 sm:w-64"
                value={clientSecretDraft}
                onChange={(event) => setClientSecretDraft(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void ensureLocalApi().shell.openExternal(
                    "https://www.notion.so/profile/integrations",
                  )
                }
              >
                Create Notion connection
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          }
        />
      ) : null}
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
