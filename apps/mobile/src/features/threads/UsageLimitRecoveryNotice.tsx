import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";
import { deriveUsageLimitRecovery, usageLimitResumeAt } from "@t3tools/shared/usageLimitRecovery";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useAtomValue } from "@effect/atom-react";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadDetail } from "../../state/use-thread-detail";

const RESET_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Resume actions for a turn stopped on a usage limit. Continuing on another
 * account needs a chat fork, which mobile does not have; that stays on web and
 * desktop.
 */
export function UsageLimitRecoveryNotice({
  environmentId,
  thread,
}: {
  environmentId: EnvironmentId;
  thread: OrchestrationThreadShell;
}) {
  const state = useThreadDetail({ environmentId, threadId: thread.id });
  const detail = Option.getOrNull(state.data);
  const supported =
    useAtomValue(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadUsageLimitResume === true;
  const resume = useAtomCommand(threadEnvironment.resumeAfterUsageLimit, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const recovery = deriveUsageLimitRecovery({
    activities: detail?.activities ?? [],
    latestUserMessageAt: thread.latestUserMessageAt,
    sessionStatus: thread.session?.status ?? null,
  });
  if (!recovery || !supported) return null;

  const run = async (action: "now" | "schedule" | "cancel", resumeAt?: string) => {
    setBusy(true);
    try {
      const result = await resume({
        environmentId,
        input: {
          threadId: thread.id,
          errorActivityId: recovery.errorActivityId,
          action,
          ...(resumeAt ? { resumeAt } : {}),
        },
      });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          action === "cancel" ? "Could not cancel the resume" : "Could not resume",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Try again in a moment.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const nowMs = Date.now();
  const resetInFuture = recovery.resetsAt !== null && Date.parse(recovery.resetsAt) > nowMs;
  const resumeAt = resetInFuture ? usageLimitResumeAt(recovery.resetsAt, nowMs) : null;
  const status =
    recovery.scheduledResumeAt !== null
      ? `Resumes automatically: ${RESET_TIME_FORMATTER.format(Date.parse(recovery.scheduledResumeAt))}`
      : resetInFuture && recovery.resetsAt !== null
        ? `Limit resets: ${RESET_TIME_FORMATTER.format(Date.parse(recovery.resetsAt))}`
        : null;

  return (
    <View
      accessibilityRole="alert"
      className="mx-3 mb-2 gap-2 rounded-xl border border-border-subtle bg-composer-panel p-3"
    >
      <Text className="text-sm font-t3-medium text-foreground">{recovery.message}</Text>
      {status ? <Text className="text-xs text-foreground-muted">{status}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {recovery.scheduledResumeAt !== null ? (
          <NoticeButton label="Cancel auto-resume" disabled={busy} onPress={() => run("cancel")} />
        ) : (
          <>
            <NoticeButton label="Resume now" disabled={busy} onPress={() => run("now")} />
            {resumeAt !== null ? (
              <NoticeButton
                primary
                label="Resume when available"
                disabled={busy}
                onPress={() => run("schedule", resumeAt)}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function NoticeButton(props: {
  label: string;
  primary?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      className={
        props.primary
          ? "min-h-11 justify-center rounded-lg bg-primary px-3"
          : "min-h-11 justify-center rounded-lg border border-border-subtle px-3"
      }
      onPress={props.onPress}
    >
      <Text
        className={
          props.primary
            ? "text-sm font-t3-medium text-primary-foreground"
            : "text-sm font-t3-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
