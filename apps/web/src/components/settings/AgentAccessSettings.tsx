import {
  type AgentAccessLevel,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthAgentAccessTokenResult,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { m as resolveNow } from "../../i18n/messages";
import {
  createServerAgentAccessToken,
  type ServerClientSessionRecord,
} from "~/environments/primary";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const EXPIRY_OPTIONS = [
  { days: 30, label: msg("30 days") },
  { days: 90, label: msg("90 days") },
  { days: 365, label: msg("1 year") },
] as const;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const ACCESS_OPTIONS: ReadonlyArray<{
  readonly access: AgentAccessLevel;
  readonly label: string;
  readonly description: string;
}> = [
  {
    access: "read",
    label: msg("Read history"),
    description: msg("Can read your history. Cannot change anything."),
  },
  {
    access: "operate",
    label: msg("Read and drive threads"),
    description: msg(
      "Can also start and message threads, and answer their approvals and questions.",
    ),
  },
];

/**
 * Agent tokens are bot sessions that can read history and, for operate tokens, drive
 * threads, whether made here or with `t3 auth session issue --read-only` or `--operate`.
 */
function agentAccessLevel(session: ServerClientSessionRecord): AgentAccessLevel | null {
  if (session.client.deviceType !== "bot") return null;
  const scopes = new Set(session.scopes);
  if (scopes.size === 1 && scopes.has(AuthOrchestrationReadScope)) return "read";
  if (
    scopes.size === 2 &&
    scopes.has(AuthOrchestrationReadScope) &&
    scopes.has(AuthOrchestrationOperateScope)
  ) {
    return "operate";
  }
  return null;
}

function claudeMcpAddCommand(
  created: Pick<AuthAgentAccessTokenResult, "mcpUrl" | "token">,
  access: AgentAccessLevel,
) {
  const name = access === "operate" ? "t3-code-control" : "t3-code-history";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- a shell command, not copy
  return `claude mcp add --transport http ${name} ${created.mcpUrl} --header "Authorization: Bearer ${created.token}"`;
}

const COPY_TARGETS = {
  token: {
    clipboard: {
      target: "token",
      unavailableMessage: msg("Clipboard API is unavailable while copying token."),
      failureMessage: msg("Failed to copy token to the clipboard."),
    },
    copied: msg("Token copied"),
    failed: msg("Could not copy the token"),
  },
  command: {
    clipboard: {
      target: "command",
      unavailableMessage: msg("Clipboard API is unavailable while copying command."),
      failureMessage: msg("Failed to copy command to the clipboard."),
    },
    copied: msg("Command copied"),
    failed: msg("Could not copy the command"),
  },
} as const;

async function copy(value: string, what: keyof typeof COPY_TARGETS) {
  const copyTarget = COPY_TARGETS[what];
  try {
    await writeTextToClipboard(value, copyTarget.clipboard);
    toastManager.add({ type: "success", title: resolveNow(copyTarget.copied) });
  } catch {
    toastManager.add({
      type: "error",
      title: resolveNow(copyTarget.failed),
      description: resolveNow(msg("Select it and copy it by hand.")),
    });
  }
}

/**
 * Settings → Connections → Agent access. Tokens let agents outside T3 Code,
 * such as a scheduled Claude Code run, read history through `/mcp/query`, or
 * also drive threads through `/mcp/operate`. They appear in the authorized
 * clients list too; revoking works from either.
 */
export function AgentAccessSection({
  clientSessions,
  revokingSessionId,
  onRevoke,
}: {
  readonly clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  readonly revokingSessionId: string | null;
  readonly onRevoke: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const tokens = clientSessions.flatMap((session) => {
    const access = agentAccessLevel(session);
    return access === null ? [] : [{ session, access }];
  });
  return (
    <SettingsSection
      {...searchableSetting("agent-access")}
      headerAction={<CreateAgentTokenDialog />}
    >
      <SettingsRow
        title={gt("Agent MCP servers")}
        description={gt(
          "Agents with a token can read your projects, threads, turns, plans, diffs and pull requests. A token that can drive threads can also start and message threads as you would.",
        )}
      />
      {tokens.map(({ session: token, access }) => (
        <SettingsRow
          key={token.sessionId}
          title={token.client.label ?? gt("Agent token")}
          description={gt("{access} · Created {created} · Expires {expires}", {
            access: access === "operate" ? gt("Reads and drives threads") : gt("Reads history"),
            created: dateFormatter.format(new Date(token.issuedAt)),
            expires: dateFormatter.format(new Date(token.expiresAt)),
          })}
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={revokingSessionId === token.sessionId}
              onClick={() => onRevoke(token.sessionId)}
            >
              {revokingSessionId === token.sessionId ? gt("Revoking…") : gt("Revoke")}
            </Button>
          }
        />
      ))}
    </SettingsSection>
  );
}

function CreateAgentTokenDialog() {
  const gt = useGT();
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number>(365);
  const [access, setAccess] = useState<AgentAccessLevel>("read");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<AuthAgentAccessTokenResult | null>(null);

  const reset = () => {
    setLabel("");
    setExpiresInDays(365);
    setAccess("read");
    setCreated(null);
  };

  const create = async () => {
    setCreating(true);
    try {
      setCreated(await createServerAgentAccessToken({ label, expiresInDays, access }));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: resolveNow(msg("Could not create the token")),
        description: error instanceof Error ? error.message : undefined,
      });
    }
    setCreating(false);
  };

  const accessOption =
    ACCESS_OPTIONS.find((option) => option.access === access) ?? ACCESS_OPTIONS[0]!;
  const expiryOption = EXPIRY_OPTIONS.find((option) => option.days === expiresInDays);
  const expiryLabel = expiryOption
    ? m(expiryOption.label)
    : gt("{days} days", { days: expiresInDays });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="xs" variant="ghost-muted">
            <PlusIcon className="size-3" />
            <T>Create token</T>
          </Button>
        }
      />
      <DialogPopup className="max-w-lg">
        {created === null ? (
          <>
            <DialogHeader>
              <DialogTitle>
                <T>Create agent token</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  A token for an agent outside T3 Code, such as a scheduled Claude Code run, to
                  reach this server over MCP.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">
                  <T context="token name field">Label</T>
                </span>
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={gt("e.g. EOD brief")}
                  disabled={creating}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">
                  <T>Access</T>
                </span>
                <Select
                  value={access}
                  onValueChange={(value) => setAccess(value as AgentAccessLevel)}
                >
                  <SelectTrigger aria-label={gt("Access")}>
                    <SelectValue>{m(accessOption.label)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {ACCESS_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.access} value={option.access}>
                        {m(option.label)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  {m(accessOption.description)}
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">
                  <T>Expires after</T>
                </span>
                <Select
                  value={String(expiresInDays)}
                  onValueChange={(value) => setExpiresInDays(Number(value))}
                >
                  <SelectTrigger aria-label={gt("Expires after")}>
                    <SelectValue>{expiryLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.days} value={String(option.days)}>
                        {m(option.label)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button variant="outline" disabled={creating} onClick={() => setOpen(false)}>
                <T context="button, closes the dialog">Cancel</T>
              </Button>
              <Button
                disabled={creating || label.trim().length === 0}
                onClick={() => void create()}
              >
                {creating ? gt("Creating…") : gt("Create token")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                <T>Copy your token now</T>
              </DialogTitle>
              <DialogDescription>
                {access === "operate" ? (
                  <T>
                    It won't be shown again. Treat it like a password: anyone with it can read and
                    drive your threads.
                  </T>
                ) : (
                  <T>
                    It won't be shown again. Treat it like a password: anyone with it can read your
                    threads.
                  </T>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <CopyableValue label={gt("Token")} value={created.token} what="token" />
              <CopyableValue
                label={gt("Add to Claude Code")}
                value={claudeMcpAddCommand(created, access)}
                what="command"
              />
              <p className="text-xs text-muted-foreground">
                <T>
                  <Var>{created.mcpUrl}</Var> works for agents on this machine. From another
                  machine, use this server's network or Tailscale address with the same path.
                </T>
              </p>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button onClick={() => setOpen(false)}>
                <T context="button, closes the dialog">Done</T>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function CopyableValue({
  label,
  value,
  what,
}: {
  readonly label: string;
  readonly value: string;
  readonly what: keyof typeof COPY_TARGETS;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <Button size="xs" variant="outline" onClick={() => void copy(value, what)}>
          <T context="button, copies the value">Copy</T>
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground select-all">
        {value}
      </pre>
    </div>
  );
}
