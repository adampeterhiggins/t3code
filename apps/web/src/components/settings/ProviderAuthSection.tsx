import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProviderAuthMethod,
  type ProviderAuthState,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

interface ProviderAuthSectionProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}

const PHASE_LABELS: Record<ProviderAuthState["phase"], string> = {
  idle: "Not signed in.",
  starting: "Starting sign-in.",
  waiting: "Waiting for sign-in.",
  verifying: "Checking credentials.",
  succeeded: "Signed in.",
  failed: "Sign-in failed.",
  cancelled: "Sign-in cancelled.",
};

/**
 * Generic sign-in section for providers whose credentials live in their CLI
 * (credential files, keychain, or an instance env var). Antigravity keeps its
 * own `ProviderSetupSection` because it also manages a downloadable runtime.
 * Setup state belongs to the environment and is never saved in client
 * settings.
 */
export function ProviderAuthSection(props: ProviderAuthSectionProps) {
  const providerName = props.provider?.displayName ?? "This provider";
  return (
    <section aria-label={`${providerName} sign-in`} className="grid gap-3 text-xs">
      {!props.enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Enable it to use it in threads.</span>
          {!props.readOnly ? (
            <Button size="xs" variant="outline" onClick={props.onEnable}>
              Enable {providerName}
            </Button>
          ) : null}
        </div>
      ) : null}
      {props.readOnly ? (
        <p className="text-muted-foreground">This connection cannot change provider setup.</p>
      ) : props.provider === undefined ||
        (props.provider.setup?.authMethods?.length ?? 0) === 0 ? null : (
        <ProviderAuthActions
          key={`${props.environmentId}:${props.instanceId}`}
          environmentId={props.environmentId}
          environmentLabel={props.environmentLabel}
          instanceId={props.instanceId}
          provider={props.provider}
          enabled={props.enabled}
        />
      )}
    </section>
  );
}

function ProviderAuthActions({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  enabled,
}: Pick<
  ProviderAuthSectionProps,
  "environmentId" | "environmentLabel" | "instanceId" | "enabled"
> & { readonly provider: ServerProvider }) {
  const providerName = provider.displayName ?? "This provider";
  const methods = provider.setup?.authMethods ?? [];
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const auth = authQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, commandOptions);
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, commandOptions);
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, commandOptions);
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, commandOptions);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [callbackDraft, setCallbackDraft] = useState({ flowId: null as string | null, value: "" });
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);
  const callbackValue = callbackDraft.flowId === auth?.flowId ? callbackDraft.value : "";
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const authenticated = provider.auth.status === "authenticated";
  const authorizationUrl = auth?.phase === "waiting" ? auth.authorizationUrl : null;
  const inputPrompt = auth?.phase === "waiting" ? auth.inputPrompt : undefined;
  const authStatusMessage =
    auth === null
      ? "Reading sign-in status."
      : authActive || auth.phase === "failed" || auth.phase === "cancelled"
        ? (auth.message ?? PHASE_LABELS[auth.phase])
        : authenticated
          ? provider.auth.label
            ? `Signed in — ${provider.auth.label}.`
            : "Signed in."
          : (auth.message ?? PHASE_LABELS.idle);
  const actionsDisabled = pendingLabel !== null || authQuery.error !== null;
  // Same default as the server: the first sign-in flow, else the first method.
  const defaultMethod =
    methods.find((method) => method.kind === "sign-in-flow") ?? methods[0] ?? null;
  const selectedMethod = methods.find((method) => method.id === selectedMethodId) ?? defaultMethod;
  // The server records which method produced the current credential
  // (`auth.methodId`, persisted across restarts) and drops it when an
  // out-of-band login replaces the credential. A just-finished flow carries
  // the id until the next probe stamps it. Without either, fall back to
  // the credential kind.
  const recordedMethodId =
    provider.auth.methodId ?? (auth?.phase === "succeeded" ? auth.methodId : undefined);
  const recordedMethod = recordedMethodId
    ? methods.find((method) => method.id === recordedMethodId)
    : undefined;
  const signedInMethodLabel =
    recordedMethod?.kind === "paste-credential"
      ? (recordedMethod.credentialLabel ?? recordedMethod.label)
      : (recordedMethod?.label ??
        (provider.auth.external === true
          ? (provider.auth.label ?? "External credential")
          : provider.auth.type === "apiKey" || provider.auth.type === "api_key"
            ? (methods.find((method) => method.kind === "paste-credential")?.credentialLabel ??
              "API key")
            : provider.auth.type === "bedrock" || provider.auth.type === "amazonBedrock"
              ? (provider.auth.label ?? "External sign-in")
              : "Account sign-in"));

  async function runCommand<A, E>(
    label: string,
    request: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Provider setup failed.");
        }
        return false;
      }
      return true;
    } catch {
      setError("Provider setup failed. Try again.");
      return false;
    } finally {
      pendingRef.current = false;
      setPendingLabel(null);
    }
  }

  async function openSignInPage() {
    if (!authorizationUrl) return;
    try {
      await ensureLocalApi().shell.openExternal(authorizationUrl);
      setError(null);
    } catch {
      setError("Could not open the sign-in page. Copy the link and open it in your browser.");
    }
  }

  async function copySignInLink() {
    if (!authorizationUrl) return;
    try {
      await writeTextToClipboard(authorizationUrl, "Sign-in link");
      setCopiedFlowId(auth?.flowId ?? null);
      setError(null);
    } catch {
      setError("Could not copy the sign-in link. Use Open sign-in page.");
    }
  }

  async function submitInput() {
    const flowId = auth?.flowId;
    if (!flowId || !callbackValue.trim() || auth.phase !== "waiting") return;
    const accepted = await runCommand("Submitting", () =>
      completeAuth({
        environmentId,
        input: { instanceId, flowId, callbackUrl: callbackValue },
      }),
    );
    if (accepted) {
      setCallbackDraft({ flowId: null, value: "" });
    }
  }

  async function startMethod(method: ProviderAuthMethod) {
    const credential = credentialDrafts[method.id]?.trim();
    if (method.kind === "paste-credential" && !credential) return;
    const accepted = await runCommand(method.label, () =>
      startAuth({
        environmentId,
        input: {
          instanceId,
          methodId: method.id,
          ...(credential ? { credential } : {}),
        },
      }),
    );
    if (accepted && method.kind === "paste-credential") {
      setCredentialDrafts((drafts) => ({ ...drafts, [method.id]: "" }));
    }
  }

  async function signOut() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Sign out of ${providerName} on ${environmentLabel}? Stored credentials are removed; running threads are unaffected.`,
    );
    if (confirmed) {
      await runCommand("Signing out", () => logoutAuth(target));
    }
  }

  return (
    <div className="grid gap-2">
      <p className="font-medium">{providerName} sign-in</p>
      <p role="status" className="text-muted-foreground [overflow-wrap:anywhere]">
        {authStatusMessage}
      </p>

      {authorizationUrl ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => void openSignInPage()}>
              Open sign-in page
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void copySignInLink()}>
              {copiedFlowId === auth?.flowId ? "Link copied" : "Copy sign-in link"}
            </Button>
          </div>
          {auth?.expiresAt ? (
            <p className="text-muted-foreground">
              Link expires at{" "}
              <time dateTime={auth.expiresAt}>
                {new Date(auth.expiresAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      {inputPrompt ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitInput();
          }}
        >
          <label htmlFor={`provider-auth-input-${instanceId}`}>{inputPrompt}</label>
          <Input
            id={`provider-auth-input-${instanceId}`}
            size="sm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={callbackValue}
            maxLength={16_384}
            disabled={actionsDisabled}
            onChange={(event) =>
              setCallbackDraft({ flowId: auth?.flowId ?? null, value: event.target.value })
            }
          />
          <Button
            size="xs"
            variant="outline"
            type="submit"
            className="w-fit"
            disabled={actionsDisabled || !callbackValue.trim()}
          >
            Continue
          </Button>
        </form>
      ) : null}

      {!authActive && authenticated ? (
        <div className="grid gap-1">
          <span>Sign-in method</span>
          <p className="text-muted-foreground">{signedInMethodLabel}</p>
          {provider.auth.external === true ? (
            <p className="text-muted-foreground text-xs">
              This credential is managed outside T3 Code — remove it there to sign out.
            </p>
          ) : null}
        </div>
      ) : null}

      {!authActive && !authenticated && selectedMethod ? (
        <div className="grid gap-2">
          {methods.length > 1 ? (
            <>
              <span>Sign-in method</span>
              <Select
                value={selectedMethod.id}
                onValueChange={(value) => setSelectedMethodId(value)}
                disabled={actionsDisabled || !enabled}
              >
                <SelectTrigger size="sm" className="w-fit min-w-48" aria-label="Sign-in method">
                  <SelectValue>{selectedMethod.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {methods.map((method) => (
                    <SelectItem key={method.id} value={method.id}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </>
          ) : null}
          {selectedMethod.description ? (
            <p className="text-muted-foreground">{selectedMethod.description}</p>
          ) : null}
          {selectedMethod.kind === "paste-credential" ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void startMethod(selectedMethod);
              }}
            >
              <label htmlFor={`provider-credential-${instanceId}-${selectedMethod.id}`}>
                {selectedMethod.credentialLabel ?? selectedMethod.label}
              </label>
              <Input
                id={`provider-credential-${instanceId}-${selectedMethod.id}`}
                size="sm"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={selectedMethod.credentialPlaceholder ?? "Paste key"}
                value={credentialDrafts[selectedMethod.id] ?? ""}
                maxLength={16_384}
                disabled={actionsDisabled || !enabled}
                onChange={(event) =>
                  setCredentialDrafts((drafts) => ({
                    ...drafts,
                    [selectedMethod.id]: event.target.value,
                  }))
                }
              />
              <Button
                size="xs"
                variant="outline"
                type="submit"
                className="w-fit"
                disabled={
                  actionsDisabled || !enabled || !(credentialDrafts[selectedMethod.id] ?? "").trim()
                }
              >
                {selectedMethod.label}
              </Button>
            </form>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="w-fit"
              disabled={actionsDisabled || !enabled || auth === null}
              onClick={() => void startMethod(selectedMethod)}
            >
              {selectedMethod.label}
            </Button>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {authActive && auth?.flowId ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={actionsDisabled}
            onClick={() => {
              const flowId = auth.flowId;
              if (!flowId) return;
              void runCommand("Cancelling sign-in", () =>
                cancelAuth({ environmentId, input: { instanceId, flowId } }),
              );
            }}
          >
            Cancel sign-in
          </Button>
        ) : null}
        {!authActive &&
        authenticated &&
        provider.setup?.canAuthenticate &&
        provider.auth.external !== true ? (
          <Button
            size="xs"
            variant="outline"
            disabled={actionsDisabled || auth === null}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        ) : null}
      </div>

      {pendingLabel ? <p role="status">{pendingLabel}.</p> : null}
      {error || authQuery.error ? (
        <div className="grid gap-2">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {error ?? authQuery.error}
          </p>
          {authQuery.error ? (
            <Button
              size="xs"
              variant="outline"
              className="w-fit"
              onClick={() => authQuery.refresh()}
            >
              Retry setup status
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
