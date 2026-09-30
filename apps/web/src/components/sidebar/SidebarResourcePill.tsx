import type { EnvironmentId, ResourceTelemetryProcess } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, GaugeIcon, MemoryStickIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useResourceTelemetry } from "../../lib/resourceTelemetryState";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import {
  formatBytes,
  resourceProcessLabel,
  processIdentityKey,
  visibleResourceTelemetryProcesses,
} from "../settings/ResourceTelemetryDiagnostics.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// The server caches one read for every client, so this only bounds staleness.
const USAGE_POLL_INTERVAL_MS = 10_000;

/**
 * The primary environment's T3 footprint in the sidebar titlebar. The pill
 * polls a cheap summary; the popover holds the live process stream only while
 * it is open.
 */
export function SidebarResourcePill() {
  const environmentId = usePrimaryEnvironmentId();
  const usage = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.resourceUsage({ environmentId, input: {} }),
  );
  const refreshUsage = usage.refresh;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (environmentId === null) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshUsage();
    }, USAGE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [environmentId, refreshUsage]);

  if (environmentId === null || usage.data === null) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button size="micro" variant="outline" aria-label="Resource usage">
                  <MemoryStickIcon />
                  <span className="tabular-nums">{formatBytes(usage.data.rssBytes)}</span>
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">Memory used by T3 Code and its agents</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" padding="none" width="md">
        {open ? (
          <ResourceUsageDetails environmentId={environmentId} onNavigate={() => setOpen(false)} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function ResourceUsageDetails({
  environmentId,
  onNavigate,
}: {
  environmentId: EnvironmentId;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const telemetry = useResourceTelemetry(environmentId);
  const snapshot = telemetry.data;
  const processes = snapshot?.processes ?? [];
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(
    () => visibleResourceTelemetryProcesses(processes, collapsed),
    [collapsed, processes],
  );
  const toggle = useCallback((process: ResourceTelemetryProcess) => {
    const key = processIdentityKey(process);
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const openDiagnostics = () => {
    onNavigate();
    void navigate({ to: "/settings/diagnostics" });
  };

  return (
    <div className="flex w-full flex-col text-xs">
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
            Resources
          </div>
          <div className="mt-0.5 text-muted-foreground">
            CPU{" "}
            <span className="font-medium tabular-nums text-foreground">
              {snapshot ? `${snapshot.groups.allT3.currentCpuPercent.toFixed(1)}%` : "—"}
            </span>{" "}
            Memory{" "}
            <span className="font-medium tabular-nums text-foreground">
              {snapshot ? formatBytes(snapshot.groups.allT3.currentRssBytes) : "—"}
            </span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                onClick={openDiagnostics}
                aria-label="Open diagnostics"
              >
                <GaugeIcon />
              </Button>
            }
          />
          <TooltipPopup side="top">Open diagnostics</TooltipPopup>
        </Tooltip>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem] gap-2 border-y border-border/60 px-3 py-1.5 text-3xs text-muted-foreground">
        <span>Name</span>
        <span className="text-right">CPU</span>
        <span className="text-right">Mem</span>
      </div>
      <ScrollArea scrollFade hideScrollbars className="max-h-72">
        {visible.length === 0 ? (
          <div className="px-3 py-3 text-muted-foreground">
            {telemetry.error ?? "Waiting for the process monitor."}
          </div>
        ) : (
          <ul className="py-1">
            {visible.map((process) => (
              <ResourceUsageRow
                key={processIdentityKey(process)}
                process={process}
                collapsed={collapsed.has(processIdentityKey(process))}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function ResourceUsageRow({
  process,
  collapsed,
  onToggle,
}: {
  process: ResourceTelemetryProcess;
  collapsed: boolean;
  onToggle: (process: ResourceTelemetryProcess) => void;
}) {
  const label = resourceProcessLabel(process);
  const ChevronIcon = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 px-3 py-0.5">
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: `${Math.min(process.depth, 6) * 10}px` }}
      >
        {process.childPids.length > 0 ? (
          <Button
            size="icon-tiny"
            variant="ghost-muted"
            onClick={() => onToggle(process)}
            aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            <ChevronIcon />
          </Button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="truncate">{label}</span>} />
          <TooltipPopup side="top" variant="code">
            <div>PID {process.identity.pid}</div>
            <div>{process.command || process.name}</div>
          </TooltipPopup>
        </Tooltip>
      </div>
      <span className="text-right tabular-nums">{process.cpuPercent.toFixed(1)}%</span>
      <span className="text-right tabular-nums text-muted-foreground">
        {formatBytes(process.residentBytes)}
      </span>
    </li>
  );
}
