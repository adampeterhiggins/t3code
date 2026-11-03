import { deriveSubagentWaitSteer } from "@t3tools/client-runtime/state/thread-workflows";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

type Projection = Parameters<typeof deriveSubagentWaitSteer>[0];

/** Fork: when a turn starts waiting on its subagents, the queue's first message steers it. */
export function useSteerQueueIntoSubagentWait(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projection: Projection | null;
  readonly enabled: boolean;
}) {
  // Another client watching the thread may promote the same message first.
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun, { reportFailure: false });
  const wait =
    input.enabled && input.projection !== null ? deriveSubagentWaitSteer(input.projection) : null;
  const seenWaitKeyRef = useRef<string | null>(null);
  const waitKey = wait?.waitKey ?? null;
  const queuedRunId = wait?.next?.queuedRunId ?? null;
  const targetRunId = wait?.next?.targetRunId ?? null;
  const { environmentId, threadId } = input;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends a server command when the projection enters a new subagent wait
  useEffect(() => {
    if (waitKey === null || seenWaitKeyRef.current === waitKey) return;
    seenWaitKeyRef.current = waitKey;
    if (queuedRunId === null || targetRunId === null) return;
    void promote({ environmentId, input: { threadId, queuedRunId, targetRunId } });
  }, [environmentId, promote, queuedRunId, targetRunId, threadId, waitKey]);
}
