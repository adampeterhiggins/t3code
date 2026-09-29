import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_LINEAR_LINK_TARGET,
  type EnvironmentId,
  type LinearConnectionState,
  type LinearLinkTarget,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { linearEnvironment } from "../../state/linear";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Linear account. The account belongs to
 * the environment, so every client of that environment can attach issues.
 */
export function LinearSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The account belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("linear")}>
      {environmentId === null ? (
        <SettingsRow
          title="Linear account"
          description="Connect to an environment to set up Linear."
        />
      ) : (
        <LinearConnectionRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
      <LinearLinkTargetSetting />
    </SettingsSection>
  );
}

const LINEAR_LINK_TARGET_LABELS: Readonly<Record<LinearLinkTarget, string>> = {
  browser: "Like other links",
  app: "Linear app",
};

/** Device-local: whether the Linear app is installed is a property of this machine. */
function LinearLinkTargetSetting() {
  const linkTarget = useClientSettings((settings) => settings.linearLinkTarget);
  const updateSettings = useUpdatePrimarySettings();
  return (
    <SettingsRow
      {...searchableSetting("linear-link-target")}
      description="Where Open in Linear goes. Like other links follows Open links in above."
      resetAction={
        linkTarget !== DEFAULT_LINEAR_LINK_TARGET ? (
          <SettingResetButton
            label="Linear links"
            onClick={() => updateSettings({ linearLinkTarget: DEFAULT_LINEAR_LINK_TARGET })}
          />
        ) : null
      }
      control={
        <Select
          value={linkTarget}
          onValueChange={(value) => {
            if (value === "browser" || value === "app") {
              updateSettings({ linearLinkTarget: value });
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Open Linear links in">
            <SelectValue>{LINEAR_LINK_TARGET_LABELS[linkTarget]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(Object.keys(LINEAR_LINK_TARGET_LABELS) as ReadonlyArray<LinearLinkTarget>).map(
              (target) => (
                <SelectItem hideIndicator key={target} value={target}>
                  {LINEAR_LINK_TARGET_LABELS[target]}
                </SelectItem>
              ),
            )}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function describeConnection(state: LinearConnectionState | null): string {
  if (state === null) return "Reading Linear status.";
  switch (state.phase) {
    case "connected":
      return state.account
        ? `Connected as ${state.account.name} (${state.account.email}) in ${state.account.workspaceName}.`
        : "Connected.";
    case "waiting":
      return "Approve T3 Code on Linear's page in your browser.";
    case "failed":
      return state.message ?? "Linear sign-in failed.";
    case "disconnected":
      return "Attach Linear issues to messages as context for the agent.";
  }
}

function LinearConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(linearEnvironment.startLogin, commandOptions);
  const completeLogin = useAtomCommand(linearEnvironment.completeLogin, commandOptions);
  const cancelLogin = useAtomCommand(linearEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(linearEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState({ flowId: null as string | null, value: "" });
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
          setError(failure instanceof Error ? failure.message : "Linear request failed.");
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
    const next = await run(() => startLogin({ environmentId, input: {} }));
    // Only the desktop shell can open a tab after an await; browsers block
    // it as a popup, so the web build relies on the Open Linear button.
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
      `Disconnect Linear from ${environmentLabel}? Issues already attached to messages stay as they are.`,
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;

  return (
    <>
      <SettingsRow
        title="Linear account"
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
                    Open Linear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => writeTextToClipboard(authorizationUrl, "Linear sign-in link")}
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
            <Button size="sm" disabled={pending} onClick={connect}>
              {state.phase === "failed" ? "Reconnect Linear" : "Connect Linear"}
            </Button>
          )
        }
      />
      {state?.phase === "waiting" ? (
        <SettingsRow
          title="Approving from another device?"
          description={`If the browser can't reach ${environmentLabel}, Linear ends on a page that won't load. Paste that page's URL here.`}
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
                aria-label="Redirect URL from Linear"
                placeholder="http://127.0.0.1:47831/callback?code=…"
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
