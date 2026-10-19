import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GranolaConnectionState } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { granolaEnvironment } from "../../state/granola";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Granola account. The account belongs to the environment,
 * so every client of that environment can attach meeting notes.
 */
export function GranolaSettingsSection() {
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The account belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("granola")}>
      {environmentId === null ? (
        <SettingsRow
          title="Granola account"
          description="Connect to an environment to set up Granola."
        />
      ) : (
        <GranolaIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? "this environment"}
        />
      )}
    </SettingsSection>
  );
}

function GranolaIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableGranolaIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return (
    <>
      <SettingsRow
        title="Enable Granola integration"
        description="Attach Granola meeting notes. Turn off to keep pasted Granola links as links without setup prompts. Your connected account is kept."
        control={
          <Switch
            aria-label="Enable Granola integration"
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableGranolaIntegration: checked })}
          />
        }
      />
      {enabled ? <GranolaConnectionRow {...props} /> : null}
    </>
  );
}

function describeConnection(state: GranolaConnectionState | null) {
  if (state === null) return "Reading Granola status.";
  switch (state.phase) {
    case "connected":
      return state.account
        ? `Connected as ${state.account.email}${state.account.workspaceName ? ` (${state.account.workspaceName})` : ""}.`
        : "Connected.";
    case "waiting":
      return (
        <>
          Open Granola's sign-in page on any device and confirm the code{" "}
          <span className="font-mono font-medium text-foreground">{state.userCode}</span>.
        </>
      );
    case "failed":
      return state.message ?? "Granola sign-in failed.";
    case "disconnected":
      return "Attach meeting notes to messages as context for the agent.";
  }
}

function GranolaConnectionRow({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const connection = useEnvironmentQuery(
    granolaEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(granolaEnvironment.startLogin, commandOptions);
  const cancelLogin = useAtomCommand(granolaEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(granolaEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const flowId = state?.phase === "waiting" ? state.flowId : null;
  const verificationUrl = state?.phase === "waiting" ? state.verificationUrl : null;

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
        setError(failure instanceof Error ? failure.message : "Granola request failed.");
      }
      return null;
    }
    return result.value;
  }

  async function openVerification(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError("Could not open the browser. Copy the link and open it yourself.");
    }
  }

  async function connect() {
    const next = await run(() => startLogin({ environmentId, input: {} }));
    // Only the desktop shell can open a tab after an await; browsers block
    // it as a popup, so the web build relies on the Open Granola button.
    if (isElectron && next?.verificationUrl) await openVerification(next.verificationUrl);
  }

  async function confirmDisconnect() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Disconnect Granola from ${environmentLabel}? Notes already attached to messages stay as they are.`,
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;

  return (
    <SettingsRow
      title="Granola account"
      description={<span className={statusClass}>{status}</span>}
      control={
        state === null ? null : state.phase === "connected" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={confirmDisconnect}>
            Disconnect
          </Button>
        ) : state.phase === "waiting" ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {verificationUrl ? (
              <>
                <Button size="sm" onClick={() => openVerification(verificationUrl)}>
                  Open Granola
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => writeTextToClipboard(verificationUrl, "Granola sign-in link")}
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
            {state.phase === "failed" ? "Reconnect Granola" : "Connect Granola"}
          </Button>
        )
      }
    />
  );
}
