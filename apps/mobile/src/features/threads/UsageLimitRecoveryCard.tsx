import { useAtomValue } from "@effect/atom-react";
import { Button } from "../../components/ui/Button";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentServerConfigsAtom } from "../../state/server";
import { useDeadlinePassed } from "../../lib/clock";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

function resumeFailureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not resume.";
}

export function UsageLimitRecoveryCard({
  thread,
  environmentId,
}: {
  thread: EnvironmentThreadShell;
  environmentId: EnvironmentId;
}) {
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const resumeUsageLimited = useAtomCommand(threadEnvironment.resumeUsageLimited, {
    reportFailure: false,
  });
  const canResumeNow =
    useAtomValue(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .usageLimitResumeNow === true;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetAt = thread.runtime?.usageLimitResetAt ?? null;
  const canSchedule =
    resetAt !== null &&
    Date.parse(resetAt) > Date.parse(thread.latestRun?.completedAt ?? thread.updatedAt);
  const resetPassed = useDeadlinePassed(resetAt === null ? null : Date.parse(resetAt));
  const runId = thread.latestRun?.runId;
  const recovery = thread.limitRecovery;
  const scheduled =
    recovery?.runId === runId && recovery?.resetAt === resetAt && recovery?.autoResume;
  if (
    thread.runtime?.status !== "failed" ||
    thread.runtime.lastErrorClass !== "usage_limit" ||
    !runId
  )
    return null;
  const snoozed =
    recovery?.snooze === true &&
    recovery.runId === runId &&
    recovery.resetAt === resetAt &&
    resetAt !== null &&
    thread.snoozedUntil !== null &&
    Date.parse(thread.snoozedUntil) === Date.parse(resetAt);
  async function resumeNow() {
    if (!runId) return;
    setPending(true);
    setError(null);
    const failure = await resumeUsageLimited({
      environmentId,
      // The thread carries the composer's model, so a switch away from the limited provider sticks.
      input: {
        threadId: thread.id,
        runId,
        modelSelection: thread.modelSelection,
        creationSource: "mobile",
      },
    }).then(
      (result) =>
        result._tag === "Failure" ? resumeFailureMessage(squashAtomCommandFailure(result)) : null,
      resumeFailureMessage,
    );
    setPending(false);
    if (failure !== null) setError(failure);
  }
  async function toggle(action: "resume" | "snooze") {
    if (!resetAt || !runId || !canSchedule) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      setError("The reset time has passed. Retry the thread manually.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await updateMetadata({
      environmentId,
      input: {
        threadId: thread.id,
        limitRecovery: {
          runId,
          resetAt,
          ...(action === "resume" ? { autoResume: !scheduled } : { snooze: !snoozed }),
        },
      },
    });
    setPending(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not change limit recovery.");
    }
  }
  return (
    <View className="mx-3 mb-2 gap-2 rounded-xl border border-warning-foreground/25 bg-screen p-3">
      <Text className="text-sm text-warning-foreground">
        {resetAt
          ? `Usage limit resets ${DateTime.toDateUtc(DateTime.makeUnsafe(resetAt)).toLocaleString()}.`
          : "The provider did not report a reset time. Retry manually when your limit is available."}
      </Text>
      {canSchedule || canResumeNow ? (
        <View className="flex-row flex-wrap gap-2">
          {canResumeNow ? (
            <Button
              label="Resume now"
              tone="secondary"
              disabled={pending}
              onPress={() => void resumeNow()}
            />
          ) : null}
          {canSchedule ? (
            <>
              <Button
                label={scheduled ? "Cancel auto-resume" : "Resume at reset"}
                tone="secondary"
                disabled={pending}
                onPress={() => void toggle("resume")}
              />
              <Button
                label={snoozed ? "Wake now" : "Snooze until reset"}
                tone="secondary"
                disabled={pending || (!snoozed && resetPassed)}
                onPress={() => void toggle("snooze")}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
