import type { ProviderInstanceId, TimestampFormat } from "@t3tools/contracts";
import type { UsageLimitRecovery } from "@t3tools/shared/usageLimitRecovery";
import { ChevronDownIcon, GitForkIcon, HourglassIcon } from "lucide-react";
import { memo } from "react";

import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import type { ProviderInstanceEntry } from "../../providerInstances";

export interface UsageLimitAlternative {
  readonly entry: ProviderInstanceEntry;
  readonly model: string;
}

/**
 * Shown in place of the thread error while the last turn is stopped on a usage
 * limit. Resume actions continue this session; the menu forks the chat into a
 * new tab on another account or model. Omitted handlers hide their actions.
 */
export const UsageLimitRecoveryBanner = memo(function UsageLimitRecoveryBanner(props: {
  recovery: UsageLimitRecovery;
  timestampFormat: TimestampFormat;
  nowMs: number;
  busy: boolean;
  onResumeNow?: () => void;
  /** Present while the provider's reported reset time is still ahead. */
  onResumeWhenAvailable?: () => void;
  onCancelScheduledResume?: () => void;
  alternatives: ReadonlyArray<UsageLimitAlternative>;
  onContinueWith?: (instanceId: ProviderInstanceId, model: string) => void;
  onChooseModel?: () => void;
}) {
  const { recovery } = props;
  const upcoming = (isoDate: string) =>
    formatUpcomingTimestamp(isoDate, props.timestampFormat, props.nowMs);
  const status =
    recovery.scheduledResumeAt !== null
      ? `Resumes automatically: ${upcoming(recovery.scheduledResumeAt)}`
      : recovery.resetsAt !== null && Date.parse(recovery.resetsAt) > props.nowMs
        ? `Limit resets: ${upcoming(recovery.resetsAt)}`
        : null;
  const canContinueElsewhere =
    props.onContinueWith !== undefined &&
    (props.alternatives.length > 0 || props.onChooseModel !== undefined);
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="warning" surface="glass" controlAlignment="first-line">
        <HourglassIcon />
        <AlertDescription>
          <div className="space-y-1">
            <p className="line-clamp-3">{recovery.message}</p>
            {status ? <p>{status}</p> : null}
          </div>
        </AlertDescription>
        <AlertAction>
          {recovery.scheduledResumeAt !== null ? (
            props.onCancelScheduledResume ? (
              <Button
                variant="outline"
                size="sm"
                disabled={props.busy}
                onClick={props.onCancelScheduledResume}
              >
                Cancel auto-resume
              </Button>
            ) : null
          ) : (
            <>
              {props.onResumeNow ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={props.busy}
                  onClick={props.onResumeNow}
                >
                  Resume now
                </Button>
              ) : null}
              {props.onResumeWhenAvailable ? (
                <Button
                  variant="default"
                  size="sm"
                  disabled={props.busy}
                  onClick={props.onResumeWhenAvailable}
                >
                  Resume when available
                </Button>
              ) : null}
            </>
          )}
          {canContinueElsewhere ? (
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="sm" disabled={props.busy} />}>
                <GitForkIcon aria-hidden="true" />
                Continue in new tab
                <ChevronDownIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end">
                {props.alternatives.map(({ entry, model }) => (
                  <MenuItem
                    key={entry.instanceId}
                    onClick={() => props.onContinueWith?.(entry.instanceId, model)}
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
                {props.onChooseModel ? (
                  <>
                    {props.alternatives.length > 0 ? <MenuSeparator /> : null}
                    <MenuItem onClick={props.onChooseModel}>Choose another model…</MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}
        </AlertAction>
      </Alert>
    </div>
  );
});
