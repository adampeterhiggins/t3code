import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";

import {
  orderItemsByPreferredIds,
  sortScopedProjectsForSidebar,
} from "../components/Sidebar.logic";
import { DraftId, type DraftThreadState, useComposerDraftStore } from "../composerDraftStore";
import { type ThreadSortInput } from "../lib/threadSort";
import { getProjectOrderKey } from "../logicalProject";
import { legacyProjectCwdPreferenceKey } from "../uiStateStore";

interface ThreadProjectContext {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/**
 * Draft sessions store `createdAt` and nothing later. Newest creation time
 * wins; equal timestamps keep store insertion order, later entries first.
 */
export function selectDetachedStartupDraft(input: {
  readonly primaryEnvironmentId: EnvironmentId;
  readonly sessions: readonly {
    readonly draftId: DraftId;
    readonly session: DraftThreadState;
  }[];
  readonly projectExists: (projectRef: ScopedProjectRef) => boolean;
  readonly threadExists: (threadRef: ScopedThreadRef) => boolean;
}): DraftId | null {
  const eligible = input.sessions
    .map((entry, storeIndex) => ({ ...entry, storeIndex }))
    .filter((entry) => {
      if (entry.session.environmentId !== input.primaryEnvironmentId) return false;
      if (entry.session.promotedTo != null) return false;
      const projectRef = scopeProjectRef(entry.session.environmentId, entry.session.projectId);
      if (!input.projectExists(projectRef)) return false;
      return !input.threadExists(
        scopeThreadRef(entry.session.environmentId, entry.session.threadId),
      );
    });
  eligible.sort((left, right) => {
    if (left.session.createdAt !== right.session.createdAt) {
      return left.session.createdAt > right.session.createdAt ? -1 : 1;
    }
    return right.storeIndex - left.storeIndex;
  });
  return eligible[0]?.draftId ?? null;
}

export function readDetachedStartupDraftId(
  primaryEnvironmentId: EnvironmentId,
  projectExists: (projectRef: ScopedProjectRef) => boolean,
  threadExists: (threadRef: ScopedThreadRef) => boolean,
): DraftId | null {
  const sessions = Object.entries(useComposerDraftStore.getState().draftThreadsByThreadKey).map(
    ([draftId, session]) => ({ draftId: DraftId.make(draftId), session }),
  );
  return selectDetachedStartupDraft({
    primaryEnvironmentId,
    sessions,
    projectExists,
    threadExists,
  });
}

export function isDetachedPrimaryConnectionReady(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly phase: EnvironmentConnectionPhase | null;
  readonly hasServerConfig: boolean;
}): boolean {
  return (
    input.primaryEnvironmentId !== null && input.phase === "connected" && input.hasServerConfig
  );
}

export function subscribeDetachedDraftStoreHydration(onStoreChange: () => void): () => void {
  return useComposerDraftStore.persist.onFinishHydration(() => {
    onStoreChange();
  });
}

export function isDetachedDraftStoreHydrated(): boolean {
  return useComposerDraftStore.persist.hasHydrated();
}

export function selectDetachedLandingProject<
  TProject extends {
    readonly id: string;
    readonly title: string;
    readonly environmentId: string;
    readonly createdAt?: string | undefined;
    readonly updatedAt?: string | undefined;
  },
  TThread extends ThreadSortInput & {
    readonly environmentId: string;
    readonly projectId: string;
    readonly archivedAt: string | null;
  },
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  primaryEnvironmentId: string | null,
): TProject | null {
  if (primaryEnvironmentId === null) return null;
  const primaryProjects = projects.filter(
    (project) => project.environmentId === primaryEnvironmentId,
  );
  return sortScopedProjectsForSidebar(primaryProjects, threads, "updated_at")[0] ?? null;
}

export function selectPreferredPrimaryProjectRef<
  TProject extends {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  },
>(input: {
  readonly projects: readonly TProject[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly projectOrder: readonly string[];
}): ScopedProjectRef | null {
  if (input.primaryEnvironmentId === null) return null;
  const primaryProjects = input.projects.filter(
    (project) => project.environmentId === input.primaryEnvironmentId,
  );
  const [preferred] = orderItemsByPreferredIds({
    items: primaryProjects,
    preferredIds: input.projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  return preferred === undefined ? null : scopeProjectRef(preferred.environmentId, preferred.id);
}

export function resolveDetachedChatNewProjectRef(input: {
  readonly activeThread: ThreadProjectContext | null;
  readonly activeDraftThread: ThreadProjectContext | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly preferredPrimaryProjectRef: ScopedProjectRef | null;
}): ScopedProjectRef | null {
  if (input.primaryEnvironmentId === null) return null;
  const current = input.activeThread ?? input.activeDraftThread;
  if (current !== null && current.environmentId === input.primaryEnvironmentId) {
    return scopeProjectRef(current.environmentId, current.projectId);
  }
  if (
    input.preferredPrimaryProjectRef !== null &&
    input.preferredPrimaryProjectRef.environmentId === input.primaryEnvironmentId
  ) {
    return input.preferredPrimaryProjectRef;
  }
  return null;
}

export interface DetachedIndexLandingInput {
  readonly attempt: number;
  readonly consumedAttempt: number | null;
  readonly stillOnIndex: boolean;
  readonly draftStoreHydrated: boolean;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly phase: EnvironmentConnectionPhase | null;
  readonly hasServerConfig: boolean;
  readonly projectRef: ScopedProjectRef | null;
  readonly projectReadable: boolean;
}

export interface DetachedIndexLandingEffects {
  readonly onConsume: (attempt: number) => void;
  readonly projectExists: (projectRef: ScopedProjectRef) => boolean;
  readonly threadExists: (threadRef: ScopedThreadRef) => boolean;
  readonly navigateToDraft: (draftId: DraftId) => Promise<void>;
  readonly startNewThread: (
    projectRef: ScopedProjectRef,
  ) => Promise<{ readonly draftId: DraftId } | null>;
}

export type DetachedIndexLandingResult = "deferred" | "restored" | "started" | "failed" | "empty";

/**
 * One index landing step. The attempt is consumed synchronously, before the
 * navigation promise settles, so a null open cannot schedule another try when
 * projects or the connection phase change. A later `attempt` is the error
 * screen's retry.
 */
export async function runDetachedIndexLanding(
  input: DetachedIndexLandingInput,
  effects: DetachedIndexLandingEffects,
): Promise<DetachedIndexLandingResult> {
  if (input.consumedAttempt === input.attempt || !input.stillOnIndex) return "deferred";
  if (
    !input.draftStoreHydrated ||
    !isDetachedPrimaryConnectionReady({
      primaryEnvironmentId: input.primaryEnvironmentId,
      phase: input.phase,
      hasServerConfig: input.hasServerConfig,
    }) ||
    input.primaryEnvironmentId === null
  ) {
    return "deferred";
  }

  const draftId = readDetachedStartupDraftId(
    input.primaryEnvironmentId,
    effects.projectExists,
    effects.threadExists,
  );
  if (draftId !== null) {
    effects.onConsume(input.attempt);
    try {
      await effects.navigateToDraft(draftId);
      return "restored";
    } catch {
      return "failed";
    }
  }

  if (input.projectRef === null || input.projectRef.environmentId !== input.primaryEnvironmentId) {
    return "empty";
  }
  if (!input.projectReadable) return "deferred";

  effects.onConsume(input.attempt);
  try {
    const opened = await effects.startNewThread(input.projectRef);
    return opened === null ? "failed" : "started";
  } catch {
    return "failed";
  }
}

/**
 * ChatView's capture listener does not claim `chat.new`, so this bubble
 * handler owns the chord. The floating shell has no command palette.
 */
export function applyChatNewShortcut(
  event: { preventDefault: () => void; stopPropagation: () => void },
  input: {
    readonly detached: boolean;
    readonly legacySidebarEnabled: boolean;
    readonly projectChoiceCount: number;
    readonly activeThread: ThreadProjectContext | null;
    readonly activeDraftThread: ThreadProjectContext | null;
    readonly primaryEnvironmentId: EnvironmentId | null;
    readonly preferredPrimaryProjectRef: ScopedProjectRef | null;
  },
  effects: {
    readonly openCommandPalette: () => void;
    readonly startNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>;
    readonly startNewThreadFromContext: () => Promise<unknown>;
  },
): void {
  if (!input.detached) {
    event.preventDefault();
    event.stopPropagation();
    if (!input.legacySidebarEnabled && input.projectChoiceCount > 1) {
      effects.openCommandPalette();
      return;
    }
    void effects.startNewThreadFromContext();
    return;
  }

  const projectRef = resolveDetachedChatNewProjectRef(input);
  if (projectRef === null) return;
  event.preventDefault();
  event.stopPropagation();
  void effects.startNewThread(projectRef);
}
