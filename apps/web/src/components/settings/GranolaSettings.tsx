import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GranolaConnectionState } from "@t3tools/contracts";
import { msg, T, useGT, Var } from "gt-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { m } from "../../i18n/messages";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { granolaEnvironment } from "../../state/granola";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * Connects the selected environment's Granola account. The account belongs to the environment,
 * so every client of that environment can attach meeting notes.
 */
export function GranolaSettingsSection() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
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
          title={gt("Granola account")}
          description={gt("Connect to an environment to set up Granola.")}
        />
      ) : (
        <GranolaIntegrationRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? gt("this environment")}
        />
      )}
    </SettingsSection>
  );
}

function GranolaIntegrationRows(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const gt = useGT();
  const enabled = useEnvironmentSettings(props.environmentId, (s) => s.enableGranolaIntegration);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return (
    <>
      <SettingsRow
        title={gt("Enable Granola integration")}
        description={gt(
          "Attach Granola meeting notes. Turn off to keep pasted Granola links as links without setup prompts. Your connected account is kept.",
        )}
        control={
          <Switch
            aria-label={gt("Enable Granola integration")}
            checked={enabled}
            onCheckedChange={(checked) => updateSettings({ enableGranolaIntegration: checked })}
          />
        }
      />
      {enabled ? <GranolaConnectionRow {...props} /> : null}
    </>
  );
}

function describeConnection(state: GranolaConnectionState | null, gt: ReturnType<typeof useGT>) {
  if (state === null) return gt("Reading Granola status.");
  switch (state.phase) {
    case "connected":
      return state.account
        ? state.account.workspaceName
          ? gt("Connected as {email} ({workspace}).", {
              email: state.account.email,
              workspace: state.account.workspaceName,
            })
          : gt("Connected as {email}.", { email: state.account.email })
        : gt("Connected.");
    case "waiting":
      return (
        <T>
          Open Granola's sign-in page on any device and confirm the code{" "}
          <span className="font-mono font-medium text-foreground">
            <Var>{state.userCode}</Var>
          </span>
          .
        </T>
      );
    case "failed":
      return state.message ?? gt("Granola sign-in failed.");
    case "disconnected":
      return gt("Attach meeting notes to messages as context for the agent.");
  }
}

function GranolaConnectionRow({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const gt = useGT();
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
        setError(failure instanceof Error ? failure.message : m(msg("Granola request failed.")));
      }
      return null;
    }
    return result.value;
  }

  async function openVerification(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError(m(msg("Could not open the browser. Copy the link and open it yourself.")));
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
      m(
        msg(
          "Disconnect Granola from {environment}? Notes already attached to messages stay as they are.",
          { environment: environmentLabel },
        ),
      ),
    );
    if (confirmed) await run(() => disconnect({ environmentId, input: {} }));
  }

  const status = error ?? describeConnection(state, gt);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;

  return (
    <SettingsRow
      title={gt("Granola account")}
      description={<span className={statusClass}>{status}</span>}
      control={
        state === null ? null : state.phase === "connected" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={confirmDisconnect}>
            <T context="button, disconnects the account">Disconnect</T>
          </Button>
        ) : state.phase === "waiting" ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {verificationUrl ? (
              <>
                <Button size="sm" onClick={() => openVerification(verificationUrl)}>
                  <T>Open Granola</T>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    writeTextToClipboard(verificationUrl, {
                      target: "Granola sign-in link",
                      unavailableMessage: msg(
                        "Clipboard API is unavailable while copying Granola sign-in link.",
                      ),
                      failureMessage: msg("Failed to copy Granola sign-in link to the clipboard."),
                    })
                  }
                >
                  <T>Copy link</T>
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
              <T context="button, cancels sign-in">Cancel</T>
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={pending} onClick={connect}>
            {state.phase === "failed" ? gt("Reconnect Granola") : gt("Connect Granola")}
          </Button>
        )
      }
    />
  );
}
