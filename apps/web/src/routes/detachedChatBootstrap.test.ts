import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DraftId, type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { getProjectOrderKey } from "../logicalProject";
import {
  applyChatNewShortcut,
  readDetachedStartupDraftId,
  runDetachedIndexLanding,
  selectDetachedLandingProject,
  selectPreferredPrimaryProjectRef,
  type DetachedIndexLandingEffects,
  type DetachedIndexLandingInput,
} from "./detachedChatBootstrap";

const PRIMARY = EnvironmentId.make("env-primary");
const REMOTE = EnvironmentId.make("env-remote");
const KEPT_MODEL: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "kept-model",
};

function projectRef(environmentId: EnvironmentId, projectId: string): ScopedProjectRef {
  return scopeProjectRef(environmentId, ProjectId.make(projectId));
}

function readyInput(overrides: Partial<DetachedIndexLandingInput> = {}): DetachedIndexLandingInput {
  return {
    attempt: 0,
    consumedAttempt: null,
    stillOnIndex: true,
    draftStoreHydrated: true,
    primaryEnvironmentId: PRIMARY,
    phase: "connected",
    hasServerConfig: true,
    projectRef: projectRef(PRIMARY, "local"),
    projectReadable: true,
    ...overrides,
  };
}

function seedDraft(input: {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly createdAt: string;
  readonly prompt?: string;
  readonly branch?: string | null;
  readonly envMode?: DraftThreadEnvMode;
}) {
  const draftId = DraftId.make(input.draftId);
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId(
      `logical:${input.environmentId}:${input.projectId}`,
      projectRef(input.environmentId, input.projectId),
      draftId,
      {
        threadId: ThreadId.make(`thread-${input.draftId}`),
        createdAt: input.createdAt,
        envMode: input.envMode ?? "local",
        environmentSelection: "manual",
        branch: input.branch ?? "kept-branch",
        runtimeMode: "full-access",
        interactionMode: "default",
        loadBalancedEnvironmentId: null,
      },
    );
  if (input.prompt !== undefined) {
    useComposerDraftStore.getState().setPrompt(draftId, input.prompt);
  }
  return draftId;
}

function landingEffects(
  overrides: Partial<DetachedIndexLandingEffects> = {},
): DetachedIndexLandingEffects {
  return {
    onConsume: () => undefined,
    projectExists: () => true,
    threadExists: () => false,
    navigateToDraft: async () => undefined,
    startNewThread: async () => ({ draftId: DraftId.make("fresh") }),
    ...overrides,
  };
}

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    promotedThreadRefsByDraftId: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detached index landing", () => {
  it("starts one thread after the primary connection becomes ready", async () => {
    let consumed: number | null = null;
    const started: string[] = [];
    let resolveStart: (value: { draftId: DraftId } | null) => void = () => undefined;
    const effects = landingEffects({
      onConsume: (attempt) => {
        consumed = attempt;
      },
      startNewThread: (ref) => {
        started.push(ref.projectId);
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      },
    });

    await expect(
      runDetachedIndexLanding(
        readyInput({
          primaryEnvironmentId: null,
          phase: "connecting",
          hasServerConfig: false,
        }),
        effects,
      ),
    ).resolves.toBe("deferred");
    expect(started).toEqual([]);

    const starting = runDetachedIndexLanding(readyInput({ consumedAttempt: consumed }), effects);
    expect(started).toEqual(["local"]);
    expect(consumed).toBe(0);

    await expect(
      runDetachedIndexLanding(
        readyInput({
          consumedAttempt: consumed,
          phase: "reconnecting",
          projectRef: projectRef(PRIMARY, "other"),
        }),
        effects,
      ),
    ).resolves.toBe("deferred");
    expect(started).toEqual(["local"]);

    resolveStart({ draftId: DraftId.make("fresh") });
    await expect(starting).resolves.toBe("started");
  });

  it("does not retry a null open when the project or connection changes", async () => {
    let consumed: number | null = null;
    const started: string[] = [];
    const effects = landingEffects({
      onConsume: (attempt) => {
        consumed = attempt;
      },
      startNewThread: async (ref) => {
        started.push(ref.projectId);
        return null;
      },
    });

    await expect(runDetachedIndexLanding(readyInput(), effects)).resolves.toBe("failed");
    await expect(
      runDetachedIndexLanding(
        readyInput({
          consumedAttempt: consumed,
          phase: "connected",
          hasServerConfig: true,
          projectRef: projectRef(PRIMARY, "other-primary"),
        }),
        effects,
      ),
    ).resolves.toBe("deferred");
    expect(started).toEqual(["local"]);

    await expect(
      runDetachedIndexLanding(readyInput({ attempt: 1, consumedAttempt: consumed }), effects),
    ).resolves.toBe("failed");
    expect(started).toEqual(["local", "local"]);
  });

  it("waits for draft hydration before starting", async () => {
    const startNewThread = vi.fn(async () => ({ draftId: DraftId.make("fresh") }));
    const effects = landingEffects({ startNewThread });

    await expect(
      runDetachedIndexLanding(readyInput({ draftStoreHydrated: false }), effects),
    ).resolves.toBe("deferred");
    expect(startNewThread).not.toHaveBeenCalled();

    await expect(runDetachedIndexLanding(readyInput(), effects)).resolves.toBe("started");
    expect(startNewThread).toHaveBeenCalledTimes(1);
  });

  it("does not start a thread on another environment", async () => {
    const startNewThread = vi.fn();
    await expect(
      runDetachedIndexLanding(
        readyInput({ projectRef: projectRef(REMOTE, "remote") }),
        landingEffects({ startNewThread }),
      ),
    ).resolves.toBe("empty");
    expect(startNewThread).not.toHaveBeenCalled();
  });

  it("picks the most recently active project on this computer", () => {
    const selected = selectDetachedLandingProject(
      [
        { id: "remote-project", title: "Remote", environmentId: REMOTE },
        { id: "older-local", title: "Older", environmentId: PRIMARY },
        { id: "newer-local", title: "Newer", environmentId: PRIMARY },
      ],
      [
        {
          environmentId: REMOTE,
          projectId: "remote-project",
          archivedAt: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
        },
        {
          environmentId: PRIMARY,
          projectId: "older-local",
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          environmentId: PRIMARY,
          projectId: "newer-local",
          archivedAt: null,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      PRIMARY,
    );

    expect(selected?.id).toBe("newer-local");
  });

  it("restores the newest local draft without rewriting text, attachments, or settings", async () => {
    seedDraft({
      draftId: "draft-older",
      environmentId: PRIMARY,
      projectId: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
      prompt: "older text",
    });
    const newest = seedDraft({
      draftId: "draft-newest",
      environmentId: PRIMARY,
      projectId: "scratch",
      createdAt: "2026-03-01T00:00:00.000Z",
      prompt: "keep this text",
      branch: "topic",
      envMode: "local",
    });
    seedDraft({
      draftId: "draft-remote",
      environmentId: REMOTE,
      projectId: "remote",
      createdAt: "2026-04-01T00:00:00.000Z",
      prompt: "remote text",
    });
    const file = {
      type: "file" as const,
      id: "file-1",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      file: null,
    };
    const attachment = {
      id: "image-1",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 8,
      dataUrl: "data:image/png;base64,aaaa",
    };
    useComposerDraftStore.setState((state) => {
      const existing = state.draftsByThreadKey[newest];
      if (!existing) throw new Error("missing draft");
      return {
        draftsByThreadKey: {
          ...state.draftsByThreadKey,
          [newest]: {
            ...existing,
            files: [file],
            persistedAttachments: [attachment],
          },
        },
      };
    });
    useComposerDraftStore.getState().setModelSelection(newest, KEPT_MODEL, { explicit: true });

    const before = useComposerDraftStore.getState();
    const session = before.getDraftSession(newest);
    const composer = before.getComposerDraft(newest);
    const navigated: DraftId[] = [];
    const setState = vi.spyOn(useComposerDraftStore, "setState");

    await expect(
      runDetachedIndexLanding(
        readyInput(),
        landingEffects({
          navigateToDraft: async (draftId) => {
            navigated.push(draftId);
          },
          startNewThread: async () => {
            throw new Error("stored draft should be opened, not replaced");
          },
        }),
      ),
    ).resolves.toBe("restored");

    const after = useComposerDraftStore.getState();
    expect(navigated).toEqual([newest]);
    expect(setState).not.toHaveBeenCalled();
    expect(after.getDraftSession(newest)).toBe(session);
    expect(after.getComposerDraft(newest)?.prompt).toBe("keep this text");
    expect(after.getComposerDraft(newest)?.files[0]).toBe(composer?.files[0]);
    expect(after.getComposerDraft(newest)?.persistedAttachments[0]).toBe(
      composer?.persistedAttachments[0],
    );
    expect(after.getComposerDraft(newest)?.modelSelectionExplicit).toBe(true);
    expect(after.getComposerDraft(newest)?.modelSelectionByProvider[KEPT_MODEL.instanceId]).toEqual(
      KEPT_MODEL,
    );
    expect(session).toMatchObject({
      environmentSelection: "manual",
      envMode: "local",
      branch: "topic",
      projectId: ProjectId.make("scratch"),
    });
    expect(after.getComposerDraft(DraftId.make("draft-older"))?.prompt).toBe("older text");
    expect(after.getComposerDraft(DraftId.make("draft-remote"))?.prompt).toBe("remote text");
  });

  it("orders equal creation times by later store entries and skips unusable drafts", () => {
    seedDraft({
      draftId: "draft-first",
      environmentId: PRIMARY,
      projectId: "first",
      createdAt: "2026-02-01T00:00:00.000Z",
      prompt: "first",
    });
    seedDraft({
      draftId: "draft-second",
      environmentId: PRIMARY,
      projectId: "second",
      createdAt: "2026-02-01T00:00:00.000Z",
      prompt: "second",
    });
    const promoted = seedDraft({
      draftId: "draft-promoted",
      environmentId: PRIMARY,
      projectId: "promoted",
      createdAt: "2026-05-01T00:00:00.000Z",
      prompt: "promoted",
    });
    seedDraft({
      draftId: "draft-opened",
      environmentId: PRIMARY,
      projectId: "opened",
      createdAt: "2026-06-01T00:00:00.000Z",
      prompt: "opened",
    });
    seedDraft({
      draftId: "draft-remote",
      environmentId: REMOTE,
      projectId: "remote",
      createdAt: "2026-07-01T00:00:00.000Z",
      prompt: "remote",
    });
    useComposerDraftStore.setState((state) => {
      const session = state.draftThreadsByThreadKey[promoted];
      if (!session) throw new Error("missing promoted draft");
      return {
        draftThreadsByThreadKey: {
          ...state.draftThreadsByThreadKey,
          [promoted]: {
            ...session,
            promotedTo: scopeThreadRef(PRIMARY, ThreadId.make("thread-live")),
          },
        },
      };
    });

    expect(
      readDetachedStartupDraftId(
        PRIMARY,
        () => true,
        (threadRef) => threadRef.threadId === ThreadId.make("thread-draft-opened"),
      ),
    ).toBe(DraftId.make("draft-second"));
  });
});

describe("detached chat.new", () => {
  function shortcutEffects() {
    return {
      openCommandPalette: vi.fn(),
      startNewThread: vi.fn(async () => undefined),
      startNewThreadFromContext: vi.fn(async () => undefined),
    };
  }

  it("keeps the main window's multi-project shortcut on the command palette", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const effects = shortcutEffects();

    applyChatNewShortcut(
      event,
      {
        detached: false,
        legacySidebarEnabled: false,
        projectChoiceCount: 3,
        activeThread: null,
        activeDraftThread: null,
        primaryEnvironmentId: PRIMARY,
        preferredPrimaryProjectRef: projectRef(PRIMARY, "local"),
      },
      effects,
    );

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(effects.openCommandPalette).toHaveBeenCalledOnce();
    expect(effects.startNewThread).not.toHaveBeenCalled();
    expect(effects.startNewThreadFromContext).not.toHaveBeenCalled();
  });

  it("keeps the main window's single-project shortcut on the shared starter", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const effects = shortcutEffects();

    applyChatNewShortcut(
      event,
      {
        detached: false,
        legacySidebarEnabled: false,
        projectChoiceCount: 1,
        activeThread: null,
        activeDraftThread: null,
        primaryEnvironmentId: PRIMARY,
        preferredPrimaryProjectRef: projectRef(PRIMARY, "local"),
      },
      effects,
    );

    expect(effects.openCommandPalette).not.toHaveBeenCalled();
    expect(effects.startNewThreadFromContext).toHaveBeenCalledOnce();
  });

  it("starts the current primary draft, including scratch, instead of the palette", () => {
    const newest = seedDraft({
      draftId: "draft-scratch",
      environmentId: PRIMARY,
      projectId: "scratch",
      createdAt: "2026-03-01T00:00:00.000Z",
      prompt: "keep this text",
    });
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const effects = shortcutEffects();
    const setState = vi.spyOn(useComposerDraftStore, "setState");

    applyChatNewShortcut(
      event,
      {
        detached: true,
        legacySidebarEnabled: false,
        projectChoiceCount: 4,
        activeThread: null,
        activeDraftThread: {
          environmentId: PRIMARY,
          projectId: ProjectId.make("scratch"),
        },
        primaryEnvironmentId: PRIMARY,
        preferredPrimaryProjectRef: projectRef(PRIMARY, "other"),
      },
      effects,
    );

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(effects.openCommandPalette).not.toHaveBeenCalled();
    expect(effects.startNewThread).toHaveBeenCalledWith(projectRef(PRIMARY, "scratch"));
    expect(effects.startNewThreadFromContext).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(newest)?.prompt).toBe(
      "keep this text",
    );
  });

  it("uses the preferred primary project when the active thread is remote", () => {
    const preferred = {
      environmentId: PRIMARY,
      id: ProjectId.make("preferred"),
      workspaceRoot: "/preferred",
    };
    const selected = selectPreferredPrimaryProjectRef({
      projects: [
        { environmentId: REMOTE, id: ProjectId.make("remote"), workspaceRoot: "/remote" },
        { environmentId: PRIMARY, id: ProjectId.make("other"), workspaceRoot: "/other" },
        preferred,
      ],
      primaryEnvironmentId: PRIMARY,
      projectOrder: [getProjectOrderKey(preferred)],
    });
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const effects = shortcutEffects();

    applyChatNewShortcut(
      event,
      {
        detached: true,
        legacySidebarEnabled: false,
        projectChoiceCount: 3,
        activeThread: { environmentId: REMOTE, projectId: ProjectId.make("remote") },
        activeDraftThread: null,
        primaryEnvironmentId: PRIMARY,
        preferredPrimaryProjectRef: selected,
      },
      effects,
    );

    expect(effects.openCommandPalette).not.toHaveBeenCalled();
    expect(effects.startNewThread).toHaveBeenCalledWith(projectRef(PRIMARY, "preferred"));
  });

  it("does not claim the shortcut when this computer has no project", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const effects = shortcutEffects();

    applyChatNewShortcut(
      event,
      {
        detached: true,
        legacySidebarEnabled: false,
        projectChoiceCount: 2,
        activeThread: { environmentId: REMOTE, projectId: ProjectId.make("remote") },
        activeDraftThread: null,
        primaryEnvironmentId: PRIMARY,
        preferredPrimaryProjectRef: null,
      },
      effects,
    );

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(effects.openCommandPalette).not.toHaveBeenCalled();
    expect(effects.startNewThread).not.toHaveBeenCalled();
  });
});
