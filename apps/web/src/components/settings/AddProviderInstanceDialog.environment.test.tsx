import type { ReactElement } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const settingsHooks = vi.hoisted(() => {
  const updateInner = vi.fn();
  return {
    read: vi.fn(() => ({ providerInstances: {} })),
    update: vi.fn(() => updateInner),
    updateInner,
  };
});

const atoms = vi.hoisted(() => ({
  providers: [] as ReadonlyArray<unknown>,
  providersAtom: Symbol("providers"),
  refreshProviders: Symbol("refreshProviders"),
  providerAuthState: Symbol("providerAuthState"),
  providerInstallState: Symbol("providerInstallState"),
  startProviderAuth: Symbol("startProviderAuth"),
  completeProviderAuth: Symbol("completeProviderAuth"),
  cancelProviderAuth: Symbol("cancelProviderAuth"),
  logoutProviderAuth: Symbol("logoutProviderAuth"),
  startProviderInstall: Symbol("startProviderInstall"),
  cancelProviderInstall: Symbol("cancelProviderInstall"),
  removeProviderInstall: Symbol("removeProviderInstall"),
}));

const commands = vi.hoisted(() => ({
  refreshProviders: vi.fn(),
  startAuth: vi.fn(),
  completeAuth: vi.fn(),
  cancelAuth: vi.fn(),
  logoutAuth: vi.fn(),
  startInstall: vi.fn(),
  cancelInstall: vi.fn(),
  removeInstall: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  value: {
    data: { phase: "idle" },
    error: null,
    isPending: false,
    isSuccess: true,
    refresh: vi.fn(),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: settingsHooks.read,
  useUpdateEnvironmentSettings: settingsHooks.update,
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => atoms.providers,
  useAtomRefresh: () => vi.fn(),
}));

vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    providersValueAtom: () => atoms.providersAtom,
    refreshProviders: atoms.refreshProviders,
    providerAuthState: () => atoms.providerAuthState,
    providerInstallState: () => atoms.providerInstallState,
    startProviderAuth: atoms.startProviderAuth,
    completeProviderAuth: atoms.completeProviderAuth,
    cancelProviderAuth: atoms.cancelProviderAuth,
    logoutProviderAuth: atoms.logoutProviderAuth,
    startProviderInstall: atoms.startProviderInstall,
    cancelProviderInstall: atoms.cancelProviderInstall,
    removeProviderInstallation: atoms.removeProviderInstall,
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => {
    switch (atom) {
      case atoms.refreshProviders:
        return commands.refreshProviders;
      case atoms.startProviderAuth:
        return commands.startAuth;
      case atoms.completeProviderAuth:
        return commands.completeAuth;
      case atoms.cancelProviderAuth:
        return commands.cancelAuth;
      case atoms.logoutProviderAuth:
        return commands.logoutAuth;
      case atoms.startProviderInstall:
        return commands.startInstall;
      case atoms.cancelProviderInstall:
        return commands.cancelInstall;
      case atoms.removeProviderInstall:
        return commands.removeInstall;
      default:
        return vi.fn();
    }
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => queryState.value,
}));

vi.mock("./settingsLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settingsLayout")>();
  return {
    ...actual,
    useSettingsSearchTargetId: () => null,
  };
});

import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import { ProviderAuthSection } from "./ProviderAuthSection";

const remoteEnvironmentId = EnvironmentId.make("remote-device");

function renderDialog(onOpenChange: () => void = vi.fn()): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return AddProviderInstanceDialog({
    open: true,
    environmentId: remoteEnvironmentId,
    environmentLabel: "Remote device",
    onOpenChange,
  }) as ReactElement<Record<string, unknown>>;
}

function findButtonByLabel(
  tree: ReactElement<Record<string, unknown>>,
  label: string,
): ReactElement<Record<string, unknown>> | null {
  return visitElements(
    tree,
    (element) => element.props.children === label && typeof element.props.onClick === "function",
  );
}

function clickButton(tree: ReactElement<Record<string, unknown>>, label: string): void {
  const button = findButtonByLabel(tree, label);
  (button?.props.onClick as (() => void) | undefined)?.();
}

describe("AddProviderInstanceDialog environment routing", () => {
  beforeEach(() => {
    hooks.reset();
    settingsHooks.read.mockClear();
    settingsHooks.update.mockClear();
    settingsHooks.updateInner.mockClear();
    commands.refreshProviders.mockReset();
  });

  it("reads and writes settings through the supplied environment", () => {
    renderDialog();

    expect(settingsHooks.read).toHaveBeenCalledWith(remoteEnvironmentId);
    expect(settingsHooks.update).toHaveBeenCalledWith(remoteEnvironmentId);
  });

  it("creates the instance on Config and lands on a sign-in step for its id", () => {
    let tree = renderDialog();
    clickButton(tree, "Next");

    tree = renderDialog();
    const idInput = visitElements(tree, (element) => element.props.placeholder === "codex_work");
    (idInput?.props.onChange as ((event: unknown) => void) | undefined)?.({
      target: { value: "codex_work" },
    });

    tree = renderDialog();
    clickButton(tree, "Next");

    tree = renderDialog();
    clickButton(tree, "Add instance");

    expect(settingsHooks.updateInner).toHaveBeenCalledWith({
      providerInstances: {
        codex_work: { driver: "codex", enabled: true },
      },
    });
    // A targeted refresh asks the server to probe the new instance so its
    // sign-in methods arrive promptly.
    expect(commands.refreshProviders).toHaveBeenCalledWith({
      environmentId: remoteEnvironmentId,
      input: { instanceId: "codex_work" },
    });

    tree = renderDialog();
    const signInSection = visitElements(tree, (element) => element.type === ProviderAuthSection);
    expect(signInSection?.props.instanceId).toBe("codex_work");
    expect(signInSection?.props.environmentId).toBe(remoteEnvironmentId);

    const onOpenChange = vi.fn();
    tree = renderDialog(onOpenChange);
    clickButton(tree, "Done");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
