import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let projectRemoved = false;
  let detached = false;
  let primaryEnvironmentId: string | null = "environment-primary";
  let routeTarget: { readonly kind: "draft"; readonly draftId: string } | null = null;
  let activeDraftSession: {
    readonly draftId: string;
    readonly logicalProjectKey: string;
    readonly promotedTo: null;
    readonly threadId: string;
    readonly createdAt: string;
    readonly runtimeMode: string;
    readonly interactionMode: string;
  } | null = null;
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const noteDetachedNewDraftOpened = vi.fn();
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => activeDraftSession),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    removeProject() {
      projectRemoved = true;
    },
    get detached() {
      return detached;
    },
    set detached(value: boolean) {
      detached = value;
    },
    get primaryEnvironmentId() {
      return primaryEnvironmentId;
    },
    set primaryEnvironmentId(value: string | null) {
      primaryEnvironmentId = value;
    },
    get routeTarget() {
      return routeTarget;
    },
    set routeTarget(value: { readonly kind: "draft"; readonly draftId: string } | null) {
      routeTarget = value;
    },
    get activeDraftSession() {
      return activeDraftSession;
    },
    set activeDraftSession(value: typeof activeDraftSession) {
      activeDraftSession = value;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      projectRemoved = false;
      detached = false;
      primaryEnvironmentId = "environment-primary";
      routeTarget = null;
      activeDraftSession = null;
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      noteDetachedNewDraftOpened.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      draftStore.getDraftSessionByLogicalProjectKey.mockReset();
      draftStore.getDraftSessionByLogicalProjectKey.mockImplementation(() => storedDraft);
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    noteDetachedNewDraftOpened,
    router,
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "primary-environment-id" ? testState.primaryEnvironmentId : testServerConfigs(),
  },
}));
vi.mock("../state/primaryEnvironment", () => ({
  primaryEnvironmentIdAtom: "primary-environment-id",
}));
vi.mock("../components/quickMessage/quickMessageWindow", () => ({
  get isDetachedChatWindow() {
    return testState.detached;
  },
}));
vi.mock("../components/quickMessage/detachedChatPresentation", () => ({
  noteDetachedNewDraftOpened: (...args: readonly unknown[]) =>
    testState.noteDetachedNewDraftOpened(...args),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/environment")>()),
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/contracts")>()),
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: () => null,
    readThreadShells: () => [],
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({
  resolveThreadRouteTarget: () => testState.routeTarget,
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";
import { useComposerDraftStore } from "../composerDraftStore";

it("pins a reused automatic draft to the explicitly selected checkout", async () => {
  const { useComposerDraftStore: realDraftStore, DraftId } =
    await vi.importActual<typeof import("../composerDraftStore")>("../composerDraftStore");
  const { EnvironmentId, ProjectId, ThreadId } =
    await vi.importActual<typeof import("@t3tools/contracts")>("@t3tools/contracts");
  testState.reset(null);
  const draftId = DraftId.make("draft-manual-checkout");
  const projectRef = {
    environmentId: EnvironmentId.make("environment-ssh"),
    projectId: ProjectId.make("project-remote"),
  };
  const store = realDraftStore.getState();
  store.setLogicalProjectDraftThreadId(
    "remote-project",
    {
      environmentId: EnvironmentId.make("environment-primary"),
      projectId: ProjectId.make("local"),
    },
    draftId,
    {
      threadId: ThreadId.make("thread-manual-checkout"),
      environmentSelection: "auto",
      loadBalancedEnvironmentId: EnvironmentId.make("environment-primary"),
    },
  );
  const getState = vi.spyOn(useComposerDraftStore, "getState").mockReturnValue(store);
  try {
    const opened = await useNewThreadHandler()(projectRef, { environmentSelection: "manual" });

    expect(opened?.draftId).toBe(draftId);
    expect(store.getDraftSession(draftId)).toMatchObject({
      environmentId: projectRef.environmentId,
      projectId: projectRef.projectId,
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    });
  } finally {
    getState.mockRestore();
    realDraftStore.setState(store, true);
  }
});

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );
});

const primaryProjectRef = {
  environmentId: "environment-ssh",
  projectId: "project-remote",
} as never;

const manualSelection = {
  environmentSelection: "manual",
  loadBalancedEnvironmentId: null,
};

describe("floating chat new threads", () => {
  it.each([
    ["new", null],
    [
      "reusable",
      {
        draftId: "draft-existing",
        environmentId: "environment-ssh",
        promotedTo: null,
        threadId: "thread-existing",
      },
    ],
  ] as const)("forces a manual primary selection for a %s draft", async (_, draft) => {
    testState.reset(draft);
    testState.detached = true;
    testState.primaryEnvironmentId = "environment-ssh";
    const pendingOpen = useNewThreadHandler()(primaryProjectRef);
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(opened?.draftId).toBe(draft?.draftId ?? "draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      primaryProjectRef,
      opened!.draftId,
      expect.objectContaining(manualSelection),
    );
    expect(testState.noteDetachedNewDraftOpened).toHaveBeenCalledWith(opened);
  });

  it("forces a manual primary selection when the open draft is empty", async () => {
    testState.reset(null);
    testState.detached = true;
    testState.primaryEnvironmentId = "environment-ssh";
    testState.routeTarget = { kind: "draft", draftId: "draft-open" };
    testState.activeDraftSession = {
      draftId: "draft-open",
      logicalProjectKey: "remote-project",
      promotedTo: null,
      threadId: "thread-open",
      createdAt: "2026-01-01T00:00:00.000Z",
      runtimeMode: "full-access",
      interactionMode: "default",
    };

    const opened = await useNewThreadHandler()(primaryProjectRef);

    expect(opened).toEqual({ draftId: "draft-open", threadId: "thread-open" });
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.noteDetachedNewDraftOpened).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      primaryProjectRef,
      "draft-open",
      expect.objectContaining(manualSelection),
    );
  });

  it("forces a manual primary selection when a concurrent draft wins", async () => {
    testState.reset(null);
    testState.detached = true;
    testState.primaryEnvironmentId = "environment-ssh";
    testState.draftStore.getDraftSessionByLogicalProjectKey
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        draftId: "draft-raced",
        environmentId: "environment-ssh",
        promotedTo: null,
        threadId: "thread-raced",
        createdAt: "2026-01-01T00:00:00.000Z",
        runtimeMode: "full-access",
        interactionMode: "default",
      } as never);

    const pendingOpen = useNewThreadHandler()(primaryProjectRef);
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(opened).toEqual({ draftId: "draft-raced", threadId: "thread-raced" });
    expect(testState.noteDetachedNewDraftOpened).toHaveBeenCalledWith(opened);
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      primaryProjectRef,
      "draft-raced",
      expect.objectContaining(manualSelection),
    );
  });

  it("refuses a destination that is not this computer", async () => {
    testState.reset(null);
    testState.detached = true;
    testState.primaryEnvironmentId = "environment-primary";

    const pendingOpen = useNewThreadHandler()(primaryProjectRef);
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
    expect(testState.noteDetachedNewDraftOpened).not.toHaveBeenCalled();
  });

  it("leaves the window alone when the draft route never opens", async () => {
    testState.reset(null);
    testState.detached = true;
    testState.primaryEnvironmentId = "environment-ssh";
    testState.router.navigate.mockRejectedValueOnce(new Error("navigation failed"));

    const pendingOpen = useNewThreadHandler()(primaryProjectRef);
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).rejects.toThrow("navigation failed");
    expect(testState.noteDetachedNewDraftOpened).not.toHaveBeenCalled();
  });
});
