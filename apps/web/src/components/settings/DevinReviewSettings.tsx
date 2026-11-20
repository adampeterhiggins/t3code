import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DevinReviewConnectionState, EnvironmentId } from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";

import type { MessageResolver } from "../../i18n/messages";
import { ensureLocalApi } from "../../localApi";
import { devinReviewEnvironment } from "../../state/devinReview";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

const DEVIN_SERVICE_USERS_URL = "https://docs.devin.ai/api-reference/authentication";

/**
 * Connects the selected environment to Devin with a pasted service user key. Findings are read
 * from GitHub without it; the key adds review status and starting reviews.
 */
export function DevinReviewSettingsSection() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { environment: scopedEnvironment } = useSettingsScope();
  const primaryEnvironment = usePrimaryEnvironment();
  // The key belongs to an environment, not a project, so a project or
  // stale selection in the header falls back to the primary environment.
  const environment = [scopedEnvironment, primaryEnvironment].find(
    (candidate) => candidate?.connection.phase === "connected",
  );
  const environmentId = environment?.environmentId ?? null;
  return (
    <SettingsSection {...searchableSetting("devin-review")}>
      {environmentId === null ? (
        <SettingsRow
          title={gt("Devin Review")}
          description={gt("Connect to an environment to set up Devin Review.")}
        />
      ) : (
        <DevinReviewConnectionRows
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment?.label ?? gt("this environment")}
        />
      )}
    </SettingsSection>
  );
}

function describeConnection(
  state: DevinReviewConnectionState | null,
  resolve: MessageResolver,
): string {
  if (state === null) return resolve(msg("Reading Devin status."));
  switch (state.phase) {
    case "connected": {
      const account = state.account;
      if (account === null) return resolve(msg("Connected."));
      if (account.method === "service-key") {
        return resolve(
          msg(
            "Connected to {org} with a service user key. Shows review status and can start reviews.",
          ),
          { org: account.orgId },
        );
      }
      return account.userName
        ? resolve(
            msg(
              "Signed in to Devin as {user} ({org}), using the Devin CLI's login on this environment. Shows review status and can start reviews.",
            ),
            { user: account.userName, org: account.orgId },
          )
        : resolve(
            msg(
              "Signed in to Devin ({org}), using the Devin CLI's login on this environment. Shows review status and can start reviews.",
            ),
            { org: account.orgId },
          );
    }
    case "waiting":
      return state.signInUrl === null
        ? resolve(msg("Starting Devin sign-in…"))
        : resolve(msg("Finish signing in to Devin in your browser."));
    case "failed":
      return state.message ?? resolve(msg("Devin sign-in failed."));
    case "disconnected":
      return resolve(
        msg(
          "Devin Review findings are read from GitHub and work without signing in. Sign in to see each review's status and start reviews from T3 Code.",
        ),
      );
  }
}

function DevinReviewConnectionRows({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const gt = useGT();
  const messages = useMessages();
  const connection = useEnvironmentQuery(
    devinReviewEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const connect = useAtomCommand(devinReviewEnvironment.connect, commandOptions);
  const disconnect = useAtomCommand(devinReviewEnvironment.disconnect, commandOptions);
  const signIn = useAtomCommand(devinReviewEnvironment.signIn, commandOptions);
  const cancelSignIn = useAtomCommand(devinReviewEnvironment.cancelSignIn, commandOptions);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [orgId, setOrgId] = useState("");

  async function submit() {
    const key = apiKey.trim();
    const org = orgId.trim();
    if (!key || !org || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await connect({ environmentId, input: { apiKey: key, orgId: org } });
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : gt("Devin request failed."));
      }
      return;
    }
    setApiKey("");
  }

  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await command();
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Devin request failed."));
    }
  }

  async function confirmDisconnect() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      gt("Disconnect Devin from {environment}? Findings stay readable from GitHub.", {
        environment: environmentLabel,
      }),
    );
    if (!confirmed || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await disconnect({ environmentId, input: {} });
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Devin request failed."));
    }
  }

  const status = error ?? describeConnection(state, messages);
  const statusClass = error !== null || state?.phase === "failed" ? "text-destructive" : undefined;
  const signedOut = state?.phase === "disconnected" || state?.phase === "failed";

  return (
    <>
      <SettingsRow
        title={gt("Devin Review")}
        description={<span className={statusClass}>{status}</span>}
        control={
          state?.phase === "connected" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={confirmDisconnect}>
              <T>Disconnect</T>
            </Button>
          ) : state?.phase === "waiting" ? (
            <div className="flex gap-2">
              {state.signInUrl === null ? null : (
                <Button
                  size="sm"
                  onClick={() => {
                    if (state.signInUrl !== null) {
                      void ensureLocalApi().shell.openExternal(state.signInUrl);
                    }
                  }}
                >
                  <T>Open Devin sign-in</T>
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void run(() => cancelSignIn({ environmentId, input: {} }))}
              >
                <T>Cancel</T>
              </Button>
            </div>
          ) : signedOut ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void run(() => signIn({ environmentId, input: {} }))}
              >
                <T>Sign in with Devin</T>
              </Button>
              {showKeyForm ? null : (
                <Button size="sm" variant="outline" onClick={() => setShowKeyForm(true)}>
                  <T>Use a service key</T>
                </Button>
              )}
            </div>
          ) : null
        }
      />
      {signedOut && showKeyForm ? (
        <SettingsRow
          title={gt("Service user key")}
          description={gt(
            "In Devin, create a service user with the {view} permission (add {manual} to start reviews), then paste its {prefix} key and your organization ID ({org}).",
            { view: "ViewReview", manual: "UseReviewManual", prefix: "cog_", org: "org-…" },
          )}
        >
          <form
            className="mt-3 flex w-full flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input
              size="sm"
              type="password"
              autoComplete="off"
              aria-label={gt("Devin service user key")}
              placeholder="cog_…"
              className="min-w-0 flex-1 sm:w-56"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Input
              size="sm"
              autoComplete="off"
              aria-label={gt("Devin organization ID")}
              placeholder="org-…"
              className="min-w-0 flex-1 sm:w-40"
              value={orgId}
              onChange={(event) => setOrgId(event.target.value)}
            />
            <Button
              size="sm"
              type="submit"
              disabled={pending || apiKey.trim().length === 0 || orgId.trim().length === 0}
            >
              <T>Connect</T>
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void ensureLocalApi().shell.openExternal(DEVIN_SERVICE_USERS_URL)}
            >
              <T>Service user docs</T>
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </form>
        </SettingsRow>
      ) : null}
    </>
  );
}
