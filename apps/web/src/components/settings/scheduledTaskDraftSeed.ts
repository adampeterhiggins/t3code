import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { ScheduledTaskDraftSeed } from "./scheduledTasksSettings.logic";

export interface PendingScheduledTaskDraft {
  readonly environmentId: EnvironmentId;
  readonly seed: ScheduledTaskDraftSeed;
}

/**
 * A new-task form to open on the Scheduled tasks page, prefilled from a composer draft. Held in
 * memory rather than the URL so a long prompt never lands in history or a shared link.
 */
export const pendingScheduledTaskDraftAtom = Atom.make<PendingScheduledTaskDraft | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("settings:pending-scheduled-task-draft"),
);

export function setPendingScheduledTaskDraft(value: PendingScheduledTaskDraft | null): void {
  appAtomRegistry.set(pendingScheduledTaskDraftAtom, value);
}
