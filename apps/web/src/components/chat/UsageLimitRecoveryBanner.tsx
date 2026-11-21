import { T, msg, useGT } from "gt-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { m, type MessageResolver } from "~/i18n/messages";
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
import { limitRecoveryOwnsSnooze } from "@t3tools/client-runtime/state/thread-execution";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@t3tools/shared/usageLimits";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { copyAdminRequest } from "./ThreadErrorBanner";
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
  errorCode: string | null;
  resetAt: string | null;
  stoppedAt: string;
  settled: boolean;
  requestPending: boolean;
  snoozedUntil: string | null;
  recovery: OrchestrationV2LimitRecovery | null;
  timestampFormat: TimestampFormat;
  resetPassed?: boolean;
  displayPassed?: boolean;
  onChange: (recovery: OrchestrationV2LimitRecoveryUpdate) => Promise<void>;
  /** Absent when the server cannot resume before the reset. */
  onResumeNow: (() => Promise<void>) | null;
  continueElsewhere: UsageLimitContinueElsewhere | null;
};

function parseEpochMs(isoDate: string | null): number | null {
  if (isoDate === null) return null;
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? parsed : null;
}

function limitRecoveryScheduleState(
  props: Pick<
    RecoveryProps,
    "runId" | "resetAt" | "stoppedAt" | "settled" | "requestPending" | "recovery" | "snoozedUntil"
  >,
) {
  // The server refuses recovery changes while a request is pending.
  const canSchedule =
    !props.settled &&
    !props.requestPending &&
    props.resetAt !== null &&
    Date.parse(props.resetAt) > Date.parse(props.stoppedAt);
  const resumes =
    canSchedule &&
    props.recovery?.runId === props.runId &&
    props.recovery.resetAt === props.resetAt &&
    props.recovery.autoResume;
  const displayAt =
    resumes &&
    props.resetAt &&
    props.snoozedUntil &&
    Date.parse(props.snoozedUntil) > Date.parse(props.resetAt)
      ? props.snoozedUntil
      : props.resetAt;
  return { canSchedule, resumes, displayAt };
}

export function useUsageLimitRecoveryBannerItem(
  props: RecoveryProps | null,
  resolve: MessageResolver = m,
): ComposerBannerStackItem | null {
  const displayAt = props === null ? null : limitRecoveryScheduleState(props).displayAt;
  const resetPassed = useDeadlinePassed(props === null ? null : parseEpochMs(props.resetAt));
  const displayPassed = useDeadlinePassed(parseEpochMs(displayAt));
  if (props === null) return null;
  return usageLimitRecoveryBannerItem({ ...props, resetPassed, displayPassed }, resolve);
}

export function usageLimitRecoveryBannerItem(
  props: RecoveryProps,
  resolve: MessageResolver = m,
): ComposerBannerStackItem {
  const { runId, errorCode, resetAt, timestampFormat } = props;
  const { canSchedule, resumes, displayAt } = limitRecoveryScheduleState(props);
  const resetAtMs = parseEpochMs(resetAt);
  const displayAtMs = parseEpochMs(displayAt);
  const resetPassed = props.resetPassed ?? (resetAtMs !== null && resetAtMs <= Date.now());
  const displayPassed = props.displayPassed ?? (displayAtMs !== null && displayAtMs <= Date.now());
  const workspaceLimit = errorCode === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = workspaceLimit || errorCode === CHATGPT_USAGE_LIMIT_CODE;
  const resumesUpcoming = resumes && !displayPassed;
  const shownAt = resumesUpcoming ? displayAt : resetAt;
  const formattedTime = shownAt
    ? formatUpcomingTimestamp(shownAt, timestampFormat, undefined, undefined, resolve)
    : null;
  const resetDescription =
    formattedTime !== null
      ? resumesUpcoming
        ? resolve(msg("Resumes {time}", { time: formattedTime }))
        : resetPassed
          ? resolve(msg("Reset {time}", { time: formattedTime }))
          : resolve(msg("Resets {time}", { time: formattedTime }))
      : resolve(msg("Reset time unavailable; retry manually"));
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    icon: chatGptLimit ? <OpenAI aria-hidden="true" /> : <GaugeIcon />,
    title: chatGptLimit
      ? resolve(msg("ChatGPT usage limit reached"))
      : resolve(msg("Usage limit reached")),
    // The action buttons take the rest of the row. Stacking the reset time
    // under the title wraps it inside that leftover column.
    descriptionPlacement: "details",
    description: workspaceLimit
      ? resolve(
          msg("You've reached your workspace's limit for using your ChatGPT plan in other apps."),
        )
      : resetDescription,
    actions: (
      <>
        {canSchedule || props.onResumeNow || props.continueElsewhere ? (
          <RecoveryActions key={`${runId}:${resetAt}`} {...props} />
        ) : null}
        {chatGptLimit ? (
          workspaceLimit ? (
            <Button size="xs" variant="ghost" onClick={copyAdminRequest}>
              <T>Copy request for admin</T>
            </Button>
          ) : (
            <ChatGptUsageButton size="xs" variant="ghost" />
          )
        ) : null}
      </>
    ),
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
  settled,
  requestPending,
}: RecoveryProps) {
  const gt = useGT();
  const [pendingAction, setPendingAction] = useState<"resume-now" | "resume" | "snooze" | null>(
    null,
  );
  const pending = pendingAction !== null;

  const canSchedule =
    !settled && !requestPending && resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  // The server leaves snoozedUntil in place after the timer wakes the thread,
  // so a snooze whose reset has passed is no longer active.
  const resetPassed = useDeadlinePassed(resetAt === null ? null : Date.parse(resetAt));
  const snoozed =
    limitRecoveryOwnsSnooze({ runId, resetAt, recovery, snoozedUntil }) && !resetPassed;
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
        description: thrownErrorMessage(cause, m) ?? m(msg("An error occurred.")),
      });
    }
    setPendingAction(null);
  }
  function toggle(action: "resume" | "snooze") {
    if (resetAt === null) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      toastManager.add({
        type: "error",
        title: m(msg("Could not snooze thread")),
        description: m(msg("The reset time has passed. Retry the thread manually.")),
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
      action === "resume"
        ? m(msg("Could not change auto-resume"))
        : m(msg("Could not snooze thread")),
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
          onClick={() => void run("resume-now", onResumeNow, m(msg("Could not resume thread")))}
        >
          <T>Resume now</T>
        </Button>
      ) : null}
      {canSchedule && (!resetPassed || onResumeNow === null || scheduled) ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle("resume")}>
          {pendingAction === "resume"
            ? gt("Saving...")
            : scheduled
              ? gt("Cancel auto-resume")
              : resetPassed && !onResumeNow
                ? gt("Resume now")
                : gt("Resume at reset")}
        </Button>
      ) : null}
      {canSchedule ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending || (!snoozed && resetPassed)}
          onClick={() => toggle("snooze")}
        >
          {pendingAction === "snooze"
            ? gt("Saving...")
            : snoozed
              ? gt("Wake now")
              : gt("Snooze until reset")}
        </Button>
      ) : null}
      {continueElsewhere ? (
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="ghost" disabled={pending} />}>
            <GitForkIcon aria-hidden="true" />
            <T>Continue in new tab</T>
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
            <MenuItem onClick={continueElsewhere.onChooseModel}>
              <T>Choose another model…</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
}
