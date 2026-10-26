import {
  type OrchestrationV2LimitRecovery,
  type OrchestrationV2LimitRecoveryUpdate,
  type ProviderInstanceId,
  type RunId,
} from "@t3tools/contracts";
import { ChevronDownIcon, GaugeIcon, GitForkIcon } from "lucide-react";
import { useState } from "react";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { deadlineStore } from "@t3tools/client-runtime/clock";
import { useDeadlinePassed } from "../../hooks/useDeadline";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { toastManager } from "../ui/toast";
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
  timestampFormat: TimestampFormat;
  onChange: (recovery: OrchestrationV2LimitRecoveryUpdate) => Promise<void>;
  /** Absent when the server cannot resume before the reset. */
  onResumeNow: (() => Promise<void>) | null;
  continueElsewhere: UsageLimitContinueElsewhere | null;
};

export function usageLimitRecoveryBannerItem(props: RecoveryProps): ComposerBannerStackItem {
  const { runId, resetAt, stoppedAt, recovery, timestampFormat } = props;
  const canSchedule = resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    priority: "urgent",
    icon: <GaugeIcon />,
    title: "Usage limit reached",
    // The action buttons take the rest of the row. Stacking the reset time
    // under the title wraps it inside that leftover column.
    descriptionPlacement: "details",
    description: resetAt
      ? scheduled
        ? `Resumes automatically about a minute after ${formatUpcomingTimestamp(resetAt, timestampFormat)}`
        : `Resets ${formatUpcomingTimestamp(resetAt, timestampFormat)}`
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
  const [pendingAction, setPendingAction] = useState<"resume-now" | "resume" | "snooze" | null>(
    null,
  );
  const pending = pendingAction !== null;

  const canSchedule = resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  // The server leaves snoozedUntil in place after the timer wakes the thread,
  // so a snooze whose reset has passed is no longer active.
  const resetPassed = useDeadlinePassed(resetAt === null ? null : Date.parse(resetAt));
  const snoozed =
    recovery?.snooze === true &&
    recovery.runId === runId &&
    recovery.resetAt === resetAt &&
    resetAt !== null &&
    snoozedUntil !== null &&
    Date.parse(snoozedUntil) === Date.parse(resetAt) &&
    !resetPassed;
  async function run(
    key: NonNullable<typeof pendingAction>,
    action: () => Promise<void>,
    failureTitle: string,
  ) {
    setPendingAction(key);
    try {
      await action();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: failureTitle,
        description: cause instanceof Error ? cause.message : "An error occurred.",
      });
    }
    setPendingAction(null);
  }
  function toggle(action: "resume" | "snooze") {
    if (resetAt === null) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      toastManager.add({
        type: "error",
        title: "Could not snooze thread",
        description: "The reset time has passed. Retry the thread manually.",
      });
      // The deadline timer can lag after a throttled tab or sleep; disable now.
      deadlineStore(Date.parse(resetAt)).refresh();
      return;
    }
    void run(
      action,
      () =>
        onChange({
          runId,
          resetAt,
          ...(action === "resume" ? { autoResume: !scheduled } : { snooze: !snoozed }),
        }),
      action === "resume" ? "Could not change auto-resume" : "Could not snooze thread",
    );
  }
  // Inline errors would widen the actions column and crush the title.
  return (
    <>
      {onResumeNow ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => void run("resume-now", onResumeNow, "Could not resume thread")}
        >
          Resume now
        </Button>
      ) : null}
      {canSchedule ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle("resume")}>
          {pendingAction === "resume"
            ? "Saving..."
            : scheduled
              ? "Cancel auto-resume"
              : "Resume at reset"}
        </Button>
      ) : null}
      {canSchedule ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending || (!snoozed && resetPassed)}
          onClick={() => toggle("snooze")}
        >
          {pendingAction === "snooze" ? "Saving..." : snoozed ? "Wake now" : "Snooze until reset"}
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
    </>
  );
}
