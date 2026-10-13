// @vitest-environment jsdom
import { CircleIcon } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { PullRequestFiltersMenu, PullRequestFilterRadioSubmenu } from "./PullRequestListFilters";

let root: Root;
let container: HTMLDivElement;
const onFilters = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onFilters.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(optionsPending: boolean, loaded = false) {
  await act(async () =>
    root.render(
      <PullRequestFiltersMenu
        state="open"
        stateOptions={[{ value: "open", label: "Open", Icon: CircleIcon }]}
        onState={() => {}}
        involvement="all"
        involvementOptions={[{ value: "all", label: "All", Icon: CircleIcon }]}
        onInvolvement={() => {}}
        filters={{}}
        onFilters={onFilters}
        optionsPending={optionsPending}
        facets={{
          loaded: loaded ? 1 : 0,
          state: {},
          involvement: {},
          draft: {},
          review: {},
          authors: loaded
            ? [{ actor: { login: "ada", name: "Ada", avatarUrl: null }, count: 1 }]
            : [],
          labels: loaded ? [{ name: "bug", color: null, count: 1 }] : [],
        }}
        host={undefined}
        hostOptions={[]}
        onHost={() => {}}
        server={undefined}
        serverOptions={[]}
        onServer={() => {}}
        projects={[]}
        projectId={undefined}
        projectEnvironmentId={undefined}
        unavailable={new Map()}
        onProject={() => {}}
      />,
    ),
  );
}

async function click(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>("button, [role^=menuitem]")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(element, text).toBeDefined();
  await act(async () => element!.click());
}

it.each([
  ["AuthorAnyone", "Loading authors…", "No authors found"],
  ["LabelsAny", "Loading labels…", "No labels in this view"],
])("distinguishes pending and empty options in %s", async (trigger, loading, empty) => {
  await render(true);
  await click("Filters");
  await click(trigger);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(loading);
  expect(document.body.textContent).not.toContain(empty);
  await render(false);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.body.textContent).toContain(empty);
});

it("keeps loaded labels selectable during a refresh, without a loading row", async () => {
  await render(true, true);
  await click("Filters");
  await click("LabelsAny");
  expect(document.querySelector('[role="status"]')).toBeNull();
  await click("bugOnly1");
  expect(onFilters.mock.calls[0]?.[0].labels).toEqual([["bug"]]);
  await render(false, true);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.body.textContent).toContain("bug");
});

it("keeps an asynchronous radio submenu available before its first option arrives", async () => {
  const renderSource = async (pending: boolean) => {
    await act(async () =>
      root.render(
        <Menu>
          <MenuTrigger>Filters</MenuTrigger>
          <MenuPopup>
            <PullRequestFilterRadioSubmenu
              label="Source"
              value="codex"
              options={pending ? [] : [{ value: "codex", label: "Codex", Icon: CircleIcon }]}
              optionsPending={pending}
              onChange={() => {}}
            />
          </MenuPopup>
        </Menu>,
      ),
    );
  };
  await renderSource(true);
  await click("Filters");
  await click("SourceLoading…");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading filters…");
  await renderSource(false);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector('[role="menuitemradio"]')?.textContent).toContain("Codex");
});
