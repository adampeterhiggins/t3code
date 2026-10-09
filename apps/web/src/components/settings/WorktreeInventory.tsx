import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId, type ManagedWorktree } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { requestConfirmDialog } from "../../confirmDialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const listWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:list-worktrees",
  tag: WS_METHODS.worktreesList,
});
const sizeWorktree = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:size-worktree",
  tag: WS_METHODS.worktreesSize,
});
const removeWorktrees = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "settings:remove-worktrees",
  tag: WS_METHODS.worktreesRemove,
});

function WorktreesOnEnvironment({
  environmentId,
  name,
}: {
  environmentId: EnvironmentId;
  name: string;
}) {
  const list = useAtomCommand(listWorktrees);
  const size = useAtomCommand(sizeWorktree);
  const remove = useAtomCommand(removeWorktrees);
  const canRemove = useAtomValue(removeWorktrees.permissionAtom(environmentId));
  const [worktrees, setWorktrees] = useState<readonly ManagedWorktree[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(true);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true);
    const result = await list({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Success") {
      setWorktrees(result.value.worktrees);
      setSelected([]);
    } else setNotice("Could not load worktrees. Refresh to try again.");
  };
  useEffect(() => {
    let cancelled = false;
    void list({ environmentId, input: {} }).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (result._tag === "Success") setWorktrees(result.value.worktrees);
      else setNotice("Could not load worktrees. Refresh to try again.");
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, list]);
  const eligible = worktrees.filter(
    (entry) => entry.dirty === false && !entry.threads.some((thread) => thread.running),
  );
  const prune = async (paths: readonly string[]) => {
    const message = `Remove ${paths.length} worktree${paths.length === 1 ? "" : "s"} from ${name}? Branches and thread history are kept. Clean checkouts can be recreated when threads resume. Running work and local changes are always protected.`;
    const confirmed = await (requestConfirmDialog(message, { variant: "destructive" }) ??
      Promise.resolve(window.confirm(message)));
    if (!confirmed) return;
    setBusy(true);
    const result = await remove({ environmentId, input: { paths } });
    if (result._tag === "Success") {
      const removed = result.value.results.filter((entry) => entry.outcome === "removed").length;
      const refused = result.value.results.filter((entry) => entry.outcome !== "removed");
      setNotice(
        `Removed ${removed} worktree${removed === 1 ? "" : "s"}.${refused.length ? ` Kept ${refused.length}: ${[...new Set(refused.map((entry) => entry.outcome.replaceAll("_", " ")))].join(", ")}.` : ""}`,
      );
    } else setNotice("Could not remove worktrees.");
    await refresh();
  };
  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">{name}</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canRemove || eligible.length === 0}
          onClick={() => setSelected(eligible.slice(0, 200).map((entry) => entry.path))}
        >
          Select up to 200 clean worktrees
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !canRemove || selected.length === 0}
          onClick={() => void prune(selected)}
        >
          Remove selected ({selected.length})
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {!busy && worktrees.length === 0 && (
        <p className="text-sm text-muted-foreground">No managed worktrees.</p>
      )}
      {worktrees.map((entry) => {
        const running = entry.threads.some((thread) => thread.running);
        const safe = entry.dirty === false && !running;
        const bytes = sizes[entry.path];
        return (
          <div key={entry.path} className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              aria-label={`Select ${entry.branch ?? entry.path}`}
              checked={selected.includes(entry.path)}
              disabled={busy || !canRemove || !safe}
              onCheckedChange={(checked) =>
                setSelected((values) =>
                  checked
                    ? [...values, entry.path]
                    : values.filter((value) => value !== entry.path),
                )
              }
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-all text-sm font-medium">
                {entry.repositoryName} · {entry.branch ?? "Unknown branch"}
              </p>
              <p className="break-all text-xs text-muted-foreground">{entry.path}</p>
              <p className="text-xs text-muted-foreground">
                {entry.state} ·{" "}
                {running
                  ? "Running — protected"
                  : entry.dirty === true
                    ? "Local changes — protected"
                    : entry.dirty === null
                      ? "Status unavailable — protected"
                      : "Clean"}
              </p>
              {entry.threads.map((thread) => (
                <p key={thread.threadId} className="break-all text-xs">
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: thread.threadId }}
                  >
                    {thread.title}
                  </Link>{" "}
                  · {thread.state}
                </p>
              ))}
              {entry.pullRequest && (
                <a
                  href={entry.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                >
                  PR #{entry.pullRequest.number} · {entry.pullRequest.state ?? "State not synced"}
                </a>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={measuring !== null}
                  onClick={() => {
                    setMeasuring(entry.path);
                    void size({ environmentId, input: { path: entry.path } }).then((result) => {
                      setMeasuring(null);
                      setSizes((values) => ({
                        ...values,
                        [entry.path]: result._tag === "Success" ? result.value.bytes : null,
                      }));
                    });
                  }}
                >
                  {measuring === entry.path
                    ? "Measuring…"
                    : bytes === undefined
                      ? "Measure size"
                      : bytes === null
                        ? "Size unavailable · retry"
                        : `${(bytes / 1024 / 1024).toFixed(1)} MiB · refresh size`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canRemove || !safe}
                  onClick={() => void prune([entry.path])}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorktreeInventorySection() {
  const { connectedEnvironments } = useSettingsScope();
  return (
    <SettingsSection id="storage-worktree-inventory" title="Managed worktrees">
      <p className="text-sm text-muted-foreground">
        Review worktrees on each selected machine. Sizes are measured on demand. Removal keeps
        branches and thread history; running threads and local changes are protected.
      </p>
      {connectedEnvironments.map((environment) =>
        environment.serverConfig?.environment.capabilities.worktreeInventory === true ? (
          <WorktreesOnEnvironment
            key={environment.environmentId}
            environmentId={environment.environmentId}
            name={environment.serverConfig.environment.label ?? environment.environmentId}
          />
        ) : (
          <p key={environment.environmentId} className="py-3 text-sm text-muted-foreground">
            Update {environment.environmentId} to review its worktrees.
          </p>
        ),
      )}
    </SettingsSection>
  );
}
