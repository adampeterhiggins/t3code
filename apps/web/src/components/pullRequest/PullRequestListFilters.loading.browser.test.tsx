import { CircleIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { PullRequestFiltersMenu, PullRequestFilterRadioSubmenu } from "./PullRequestListFilters";

function filtersMenu(
  onFilters: ComponentProps<typeof PullRequestFiltersMenu>["onFilters"],
  optionsPending: boolean,
  loaded = false,
) {
  return (
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
    />
  );
}

function sourceMenu(pending: boolean) {
  return (
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
    </Menu>
  );
}

// The search field's busy spinner is aria-hidden; only the loading row is announced.
const announcedStatus = () => document.querySelector('[role="status"]:not([aria-hidden="true"])');

async function click(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>("button, [role^=menuitem]")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(element, text).toBeDefined();
  await act(() => element!.click());
}

it.each([
  ["AuthorAnyone", "Loading authors…", "No authors found"],
  ["LabelsAny", "Loading labels…", "No labels found"],
])("distinguishes pending and empty options in %s", async (trigger, loading, empty) => {
  const onFilters = vi.fn();
  await using screen = await render(filtersMenu(onFilters, true));
  await click("Filters");
  await click(trigger);
  expect(announcedStatus()?.textContent).toBe(loading);
  expect(document.body.textContent).not.toContain(empty);
  await screen.rerender(filtersMenu(onFilters, false));
  expect(announcedStatus()).toBeNull();
  expect(document.body.textContent).toContain(empty);
});

it("keeps loaded labels selectable during a refresh, without a loading row", async () => {
  const onFilters = vi.fn();
  await using screen = await render(filtersMenu(onFilters, true, true));
  await click("Filters");
  await click("LabelsAny");
  expect(announcedStatus()).toBeNull();
  await click("bugOnly1");
  expect(onFilters.mock.calls[0]?.[0].labels).toEqual([["bug"]]);
  await screen.rerender(filtersMenu(onFilters, false, true));
  expect(announcedStatus()).toBeNull();
  expect(document.body.textContent).toContain("bug");
});

it("keeps an asynchronous radio submenu available before its first option arrives", async () => {
  await using screen = await render(sourceMenu(true));
  await click("Filters");
  await click("SourceLoading…");
  expect(announcedStatus()?.textContent).toBe("Loading filters…");
  await screen.rerender(sourceMenu(false));
  expect(announcedStatus()).toBeNull();
  expect(document.querySelector('[role="menuitemradio"]')?.textContent).toContain("Codex");
});
