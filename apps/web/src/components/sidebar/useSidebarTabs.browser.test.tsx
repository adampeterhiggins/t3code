import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { useSidebarTabs } from "./useSidebarTabs";

const mocks = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_CLIENT_SETTINGS,
  hydrated: false,
  updateSettings: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(mocks.settings),
  useClientSettingsHydrated: () => mocks.hydrated,
  updateClientSettings: mocks.updateSettings,
}));
vi.mock("../../threadTabRecencyStore", () => ({
  useThreadTabRecencyStore: () => ({}),
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: mocks.toast, close: vi.fn() },
}));

const overridesKey = "t3code:sidebar:tab-group-overrides";
const ranksKey = "t3code:sidebar:tab-manual-ranks";

function setup() {
  mocks.settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarTabSortOrder: "created_at",
    sidebarTabSortDirection: "asc",
    sidebarTabLimit: 2,
  };
  mocks.hydrated = true;
  mocks.updateSettings.mockReset();
  mocks.toast.mockReset();
  const stack = new DisposableStack();
  for (const key of [overridesKey, ranksKey]) {
    const previous = localStorage.getItem(key);
    localStorage.removeItem(key);
    stack.defer(() => {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    });
  }
  return stack;
}

function Probe({ keys = ["a", "b", "c"] }: { keys?: string[] }) {
  const threads = keys.map(
    (id, index) =>
      ({
        environmentId: "local",
        id,
        createdAt: new Date(index * 1000).toISOString(),
      }) as EnvironmentThreadShell,
  );
  const tabs = useSidebarTabs(threads, new Map());
  const layout = tabs.layoutTabGroups(new Map([["local:group", threads]]), [], []);
  useLayoutEffect(() => tabs.commitTabLayout(layout));
  return (
    <>
      <output aria-label="Overrides">{JSON.stringify(tabs.tabGroupOverrides)}</output>
      <output aria-label="Order">
        {layout
          .get("local:group")
          ?.ordered.map((thread) => thread.id)
          .join(",")}
      </output>
      <output aria-label="Ranks">{JSON.stringify(tabs.tabManualRanks)}</output>
      <button onClick={() => tabs.toggleTabGroup("local:group")}>Toggle group</button>
      <button onClick={() => tabs.handleTabPointerRest("local:group", true)}>Enter list</button>
      <button onClick={() => tabs.handleTabPointerRest("local:group", false)}>Leave list</button>
      <button onClick={() => tabs.handleTabOverflowPreview("local:group", true)}>
        Open preview
      </button>
      <button onClick={() => tabs.handleTabOverflowPreview("local:group", false)}>
        Close preview
      </button>
      <button onClick={() => tabs.handleTabReorder("local:group", "local:b", "local:a")}>
        Reorder
      </button>
    </>
  );
}

it("retains stored group choices until settings hydrate, then resets them permanently", async () => {
  using _setup = setup();
  mocks.hydrated = false;
  localStorage.setItem(
    overridesKey,
    JSON.stringify({ showTabs: true, groups: { "local:group": false } }),
  );
  await using screen = await render(<Probe />);
  expect(JSON.parse(localStorage.getItem(overridesKey)!)).toEqual({
    showTabs: true,
    groups: { "local:group": false },
  });
  mocks.settings = { ...mocks.settings, sidebarShowTabs: true };
  mocks.hydrated = true;
  await screen.rerender(<Probe />);
  await expect
    .element(screen.getByLabelText("Overrides"))
    .toHaveTextContent('{"local:group":false}');
  mocks.settings = { ...mocks.settings, sidebarShowTabs: false };
  await screen.rerender(<Probe />);
  await expect.element(screen.getByLabelText("Overrides")).toHaveTextContent("{}");
  mocks.settings = { ...mocks.settings, sidebarShowTabs: true };
  await screen.rerender(<Probe />);
  await expect.element(screen.getByLabelText("Overrides")).toHaveTextContent("{}");
  expect(JSON.parse(localStorage.getItem(overridesKey)!)).toEqual({ showTabs: true, groups: {} });
});

it("toggles only the chosen environment-scoped group", async () => {
  using _setup = setup();
  localStorage.setItem(
    overridesKey,
    JSON.stringify({ showTabs: false, groups: { "remote:group": true } }),
  );
  await using screen = await render(<Probe />);
  await screen.getByRole("button", { name: "Toggle group" }).click();
  await expect
    .element(screen.getByLabelText("Overrides"))
    .toHaveTextContent('{"remote:group":true,"local:group":true}');
  await screen.getByRole("button", { name: "Toggle group" }).click();
  await expect
    .element(screen.getByLabelText("Overrides"))
    .toHaveTextContent('{"remote:group":true}');
});

it("holds live order while either the list or its portaled preview is being read", async () => {
  using _setup = setup();
  await using screen = await render(<Probe />);
  await screen.getByRole("button", { name: "Enter list" }).click();
  await screen.getByRole("button", { name: "Open preview" }).click();
  await screen.getByRole("button", { name: "Leave list" }).click();
  await screen.rerender(<Probe keys={["b", "a", "c"]} />);
  await expect.element(screen.getByLabelText("Order")).toHaveTextContent("a,b,c");
  await screen.getByRole("button", { name: "Close preview" }).click();
  await expect.element(screen.getByLabelText("Order")).toHaveTextContent("b,a,c");
});

it("reorders visible tabs without losing overflow and offers the previous sort as undo", async () => {
  using _setup = setup();
  await using screen = await render(<Probe />);
  await screen.getByRole("button", { name: "Enter list" }).click();
  await screen.getByRole("button", { name: "Reorder" }).click();
  await expect
    .element(screen.getByLabelText("Ranks"))
    .toHaveTextContent('{"local:b":0,"local:a":1,"local:c":2}');
  await screen.rerender(<Probe keys={["c", "a", "b"]} />);
  await expect.element(screen.getByLabelText("Order")).toHaveTextContent("c,a,b");
  expect(mocks.updateSettings).toHaveBeenCalledWith({ sidebarTabSortOrder: "manual" });
  const toast = mocks.toast.mock.calls[0]?.[0];
  toast.actionProps.onClick();
  expect(mocks.updateSettings).toHaveBeenLastCalledWith({
    sidebarTabSortOrder: "created_at",
    sidebarTabSortDirection: mocks.settings.sidebarTabSortDirection,
  });
});
