import {
  type OrchestrationV2LimitRecovery,
  type OrchestrationV2LimitRecoveryUpdate,
  type ProviderInstanceId,
  type RunId,
} from "@t3tools/contracts";
import { ChevronDownIcon, GaugeIcon, GitForkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export interface UsageLimitAlternative {
  readonly entry: ProviderInstanceEntry;
  readonly model: string;
}

/** Forks the chat into a new tab on another account or model. */
export interface UsageLimitContinueElsewhere {
  readonly alternatives: ReadonlyArray<UsageLimitAlternative>;
  readonly onContinueWith: (instanceId: ProviderInstanceId, model: string) => void;
  readonly onChooseModel: () => void;
}

type RecoveryProps = {
  runId: RunId;
  resetAt: string | null;
  stoppedAt: string;
  snoozedUntil: string | null;
  recovery: OrchestrationV2LimitRecovery | null;
  onChange: (recovery: OrchestrationV2LimitRecoveryUpdate) => Promise<void>;
  /** Absent when the server cannot resume before the reset. */
  onResumeNow: (() => Promise<void>) | null;
  continueElsewhere: UsageLimitContinueElsewhere | null;
};

export function usageLimitRecoveryBannerItem(props: RecoveryProps): ComposerBannerStackItem {
  const { runId, resetAt, stoppedAt, recovery } = props;
  const canSchedule = resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    priority: "urgent",
    icon: <GaugeIcon />,
    title: "Usage limit reached",
    description: resetAt
      ? scheduled
        ? `Resumes automatically about a minute after ${new Date(resetAt).toLocaleString()}`
        : `Resets ${new Date(resetAt).toLocaleString()}`
      : "Reset time unavailable; retry manually",
    actions:
      canSchedule || props.onResumeNow || props.continueElsewhere ? (
        <RecoveryActions key={`${runId}:${resetAt}`} {...props} />
      ) : null,
  };
}

function RecoveryActions({
  runId,
  resetAt,
  stoppedAt,
  recovery,
  snoozedUntil,
  onChange,
  onResumeNow,
  continueElsewhere,
}: RecoveryProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const delay = Date.parse(resetAt ?? "") - Math.max(nowMs, Date.now());
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.min(delay + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [resetAt, nowMs]);

  const canSchedule = resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  const snoozed =
    recovery?.snooze === true &&
    recovery.runId === runId &&
    recovery.resetAt === resetAt &&
    resetAt !== null &&
    snoozedUntil !== null &&
    Date.parse(snoozedUntil) === Date.parse(resetAt);
  async function run(action: () => Promise<void>, fallback: string) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    }
    setPending(false);
  }
  function toggle(action: "resume" | "snooze") {
    if (resetAt === null) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      setError("The reset time has passed. Retry the thread manually.");
      setNowMs(Date.now());
      return;
    }
    void run(
      () =>
        onChange({
          runId,
          resetAt,
          ...(action === "resume" ? { autoResume: !scheduled } : { snooze: !snoozed }),
        }),
      "Could not change limit recovery.",
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onResumeNow ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => void run(onResumeNow, "Could not resume.")}
        >
          Resume now
        </Button>
      ) : null}
      {canSchedule ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle("resume")}>
          {pending ? "Saving..." : scheduled ? "Cancel auto-resume" : "Resume at reset"}
        </Button>
      ) : null}
      {canSchedule && !snoozed ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending || Date.parse(resetAt!) <= nowMs}
          onClick={() => toggle("snooze")}
        >
          {pending ? "Saving..." : "Snooze until reset"}
        </Button>
      ) : null}
      {continueElsewhere ? (
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="ghost" disabled={pending} />}>
            <GitForkIcon aria-hidden="true" />
            Continue in new tab
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            {continueElsewhere.alternatives.map(({ entry, model }) => (
              <MenuItem
                key={entry.instanceId}
                onClick={() => continueElsewhere.onContinueWith(entry.instanceId, model)}
              >
                <ProviderInstanceIcon
                  driverKind={entry.driverKind}
                  displayName={entry.displayName}
                  accentColor={entry.accentColor}
                  showBadge
                  className="size-4"
                  iconClassName="size-4"
                  badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
                />
                <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
              </MenuItem>
            ))}
            {continueElsewhere.alternatives.length > 0 ? <MenuSeparator /> : null}
            <MenuItem onClick={continueElsewhere.onChooseModel}>Choose another model…</MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
