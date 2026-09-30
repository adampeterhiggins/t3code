import { AuthOrchestrationReadScope, type AuthAgentAccessTokenResult } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
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
import { searchableSetting } from "./settingsSearch";

const EXPIRY_OPTIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
] as const;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Agent tokens are read-only bot sessions, whether made here or with `t3 auth session issue --read-only`. */
function isAgentAccessToken(session: ServerClientSessionRecord): boolean {
  return (
    session.client.deviceType === "bot" &&
    session.scopes.length === 1 &&
    session.scopes[0] === AuthOrchestrationReadScope
  );
}

function claudeMcpAddCommand(created: Pick<AuthAgentAccessTokenResult, "mcpUrl" | "token">) {
  return `claude mcp add --transport http t3-code-history ${created.mcpUrl} --header "Authorization: Bearer ${created.token}"`;
}

async function copy(value: string, what: string) {
  try {
    await writeTextToClipboard(value, what);
    toastManager.add({
      type: "success",
      title: `${what[0]?.toUpperCase()}${what.slice(1)} copied`,
    });
  } catch {
    toastManager.add({
      type: "error",
      title: `Could not copy the ${what}`,
      description: "Select it and copy it by hand.",
    });
  }
}

/**
 * Settings → Connections → Agent access. Tokens let agents outside T3 Code,
 * such as a scheduled Claude Code run, read history through `/mcp/query`.
 * They appear in the authorized clients list too; revoking works from either.
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
  const tokens = clientSessions.filter(isAgentAccessToken);
  return (
    <SettingsSection
      {...searchableSetting("agent-access")}
      headerAction={<CreateAgentTokenDialog />}
    >
      <SettingsRow
        title="Query MCP server"
        description="Agents with a token can read your projects, threads, turns, plans, diffs and pull requests. They cannot change anything."
      />
      {tokens.map((token) => (
        <SettingsRow
          key={token.sessionId}
          title={token.client.label ?? "Agent token"}
          description={`Created ${dateFormatter.format(new Date(token.issuedAt))} · Expires ${dateFormatter.format(new Date(token.expiresAt))}`}
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={revokingSessionId === token.sessionId}
              onClick={() => onRevoke(token.sessionId)}
            >
              {revokingSessionId === token.sessionId ? "Revoking…" : "Revoke"}
            </Button>
          }
        />
      ))}
    </SettingsSection>
  );
}

function CreateAgentTokenDialog() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number>(365);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<AuthAgentAccessTokenResult | null>(null);

  const reset = () => {
    setLabel("");
    setExpiresInDays(365);
    setCreated(null);
  };

  const create = async () => {
    setCreating(true);
    try {
      setCreated(await createServerAgentAccessToken({ label, expiresInDays }));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not create the token",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  };

  const expiryLabel =
    EXPIRY_OPTIONS.find((option) => option.days === expiresInDays)?.label ??
    `${expiresInDays} days`;

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
          <Button size="xs" variant="default">
            <PlusIcon className="size-3" />
            Create token
          </Button>
        }
      />
      <DialogPopup className="max-w-lg">
        {created === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create agent token</DialogTitle>
              <DialogDescription>
                A read-only token for an agent outside T3 Code, such as a scheduled Claude Code run,
                to query your history over MCP.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">Label</span>
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. EOD brief"
                  disabled={creating}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">
                  Expires after
                </span>
                <Select
                  value={String(expiresInDays)}
                  onValueChange={(value) => setExpiresInDays(Number(value))}
                >
                  <SelectTrigger aria-label="Expires after">
                    <SelectValue>{expiryLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.days} value={String(option.days)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button variant="outline" disabled={creating} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={creating || label.trim().length === 0}
                onClick={() => void create()}
              >
                {creating ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your token now</DialogTitle>
              <DialogDescription>
                It won't be shown again. Treat it like a password: anyone with it can read your
                threads.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <CopyableValue label="Token" value={created.token} what="token" />
              <CopyableValue
                label="Add to Claude Code"
                value={claudeMcpAddCommand(created)}
                what="command"
              />
              <p className="text-xs text-muted-foreground">
                {created.mcpUrl} works for agents on this machine. From another machine, use this
                server's network or Tailscale address with the same path.
              </p>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button onClick={() => setOpen(false)}>Done</Button>
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
  readonly what: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <Button size="xs" variant="outline" onClick={() => void copy(value, what)}>
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground select-all">
        {value}
      </pre>
    </div>
  );
}
