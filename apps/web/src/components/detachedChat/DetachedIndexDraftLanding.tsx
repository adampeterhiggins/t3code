import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  type ComponentType,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import {
  isDetachedDraftStoreHydrated,
  isDetachedPrimaryConnectionReady,
  runDetachedIndexLanding,
  selectDetachedLandingProject,
  subscribeDetachedDraftStoreHydration,
} from "../../routes/detachedChatBootstrap";
import {
  readProject,
  readThreadShell,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { usePrimaryEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { NoProjectsHero } from "../NoProjectsHero";
import { restoreDetachedStartupDraft } from "../quickMessage/detachedChatPresentation";

/**
 * The floating window's index: it restores or starts its startup draft once the router, the
 * draft store and the primary connection are ready, instead of the main window's project landing.
 */
export function DetachedIndexDraftLanding(props: {
  readonly StartError: ComponentType<{ readonly onRetry: () => void }>;
}) {
  const { StartError } = props;
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const { scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const router = useRouter();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironment = usePrimaryEnvironment();
  const draftStoreHydrated = useSyncExternalStore(
    subscribeDetachedDraftStoreHydration,
    isDetachedDraftStoreHydrated,
    isDetachedDraftStoreHydrated,
  );
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  // A quick message starts without a project, so it files under Quick messages.
  const startNewThread = useEffectEvent(async (projectRef: ScopedProjectRef) => {
    if (scratchWorkspaceRootFor(projectRef.environmentId) === null) {
      return handleNewThread(projectRef, { replace: true });
    }
    const scratch = await openScratchProject(projectRef.environmentId);
    return scratch === null
      ? null
      : handleNewThread(scopeProjectRef(scratch.environmentId, scratch.id), { replace: true });
  });
  const navigateToDraft = useEffectEvent(async (draftId: string) => {
    await restoreDetachedStartupDraft({
      navigate: () =>
        router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
          replace: true,
        }),
      router,
      draftId,
    });
  });
  const consumedAttemptRef = useRef<number | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });
  const attempt = startState.retryRequest;
  const landingProject = selectDetachedLandingProject(projects, threads, primaryEnvironmentId);
  const connectionPhase = primaryEnvironment?.connection.phase ?? null;
  const hasServerConfig = primaryEnvironment?.serverConfig != null;
  const primaryReady = isDetachedPrimaryConnectionReady({
    primaryEnvironmentId,
    phase: connectionPhase,
    hasServerConfig,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores or starts the floating window's startup draft once the router can navigate
  useEffect(() => {
    const projectRef =
      landingProject === null
        ? null
        : scopeProjectRef(landingProject.environmentId, landingProject.id);
    void runDetachedIndexLanding(
      {
        attempt,
        consumedAttempt: consumedAttemptRef.current,
        stillOnIndex: isStillOnIndex(),
        draftStoreHydrated,
        primaryEnvironmentId,
        phase: connectionPhase,
        hasServerConfig,
        projectRef,
        projectReadable: projectRef !== null && readProject(projectRef) !== null,
      },
      {
        onConsume: (consumedAttempt) => {
          consumedAttemptRef.current = consumedAttempt;
        },
        projectExists: (ref) => readProject(ref) !== null,
        threadExists: (ref) => readThreadShell(ref) !== null,
        navigateToDraft,
        startNewThread,
      },
    ).then((outcome) => {
      if (outcome === "failed") {
        setStartState((state) => ({ ...state, failed: true }));
      }
    });
  }, [
    attempt,
    connectionPhase,
    draftStoreHydrated,
    hasServerConfig,
    landingProject,
    primaryEnvironmentId,
  ]);

  if (!draftStoreHydrated || !primaryReady) return null;
  if (startState.failed) {
    return (
      <StartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    );
  }
  if (landingProject !== null) return null;
  return bootstrapped ? <NoProjectsHero /> : null;
}
