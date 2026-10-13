// @vitest-environment jsdom
import type { LinearFilterOptions } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_LINEAR_ISSUE_FILTERS,
  DEFAULT_LINEAR_ISSUE_SORT,
  LinearIssueFilterBar,
} from "./LinearIssueFilters";

let root: Root;
let container: HTMLDivElement;
const retry = vi.fn();
const change = vi.fn();
const options: LinearFilterOptions = {
  teams: [{ id: "team", key: "ENG", name: "Engineering" }],
  states: [],
  projects: [],
  users: [],
  labels: [{ name: "Bug", color: "#ff0000" }],
};

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
  retry.mockReset();
  change.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  data: LinearFilterOptions | null,
  error: string | null = null,
  pending = false,
) {
  await act(async () =>
    root.render(
      <LinearIssueFilterBar
        options={data}
        optionsError={error}
        optionsPending={pending}
        onRetryOptions={retry}
        view={{ filters: DEFAULT_LINEAR_ISSUE_FILTERS, sort: DEFAULT_LINEAR_ISSUE_SORT }}
        searching={false}
        onChange={change}
      />,
    ),
  );
}

async function click(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>("button, [role^=menuitem]")].find(
    // Multi-select rows end with their hidden "Only" button.
    (item) => item.textContent?.trim().replace(/Only$/, "") === text,
  );
  expect(element, text).toBeDefined();
  await act(async () => element!.click());
}

it("shows loading in a metadata submenu, then populates it when the request finishes", async () => {
  await render(null, null, true);
  await click("Filter");
  await click("Team");
  expect(document.body.textContent).toContain("Loading filters…");
  await render(options);
  expect(document.body.textContent).toContain("Engineering (ENG)");
  expect(document.body.textContent).not.toContain("Loading filters…");
  await click("Engineering (ENG)");
  expect(change.mock.calls[0]?.[0].filters.teamIds).toEqual(["team"]);
});

it("retries a failed request when opening filters and allows an explicit retry", async () => {
  await render(null, "Could not reach Linear.");
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Could not reach Linear.",
  );
  await click("Retry");
  expect(retry).toHaveBeenCalledTimes(1);
  await click("Filter");
  expect(retry).toHaveBeenCalledTimes(2);
  await click("Label");
  expect(document.body.textContent).toContain("Could not load filters");
  await render(options);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.body.textContent).toContain("Bug");
});

it("distinguishes an empty workspace from a request that is still loading", async () => {
  await render({ ...options, labels: [] });
  await click("Filter");
  await click("Label");
  expect(document.body.textContent).toContain("No labels");
  expect(document.body.textContent).not.toContain("Loading filters…");
});

it.each(["Assignee", "Team", "Project", "Milestone", "Status", "Label"])(
  "shows loading in the %s filter while metadata is missing",
  async (label) => {
    await render(null, null, true);
    await click("Filter");
    await click(label);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading filters…");
    expect(document.body.textContent).not.toContain("No milestones");
  },
);

it("keeps cached choices visible while refreshing metadata", async () => {
  await render(options, null, true);
  await click("Filter");
  await click("Team");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading filters…");
  expect(document.body.textContent).toContain("Engineering (ENG)");
  await render(options);
  expect(document.querySelector('[role="status"]')).toBeNull();
});

it("does not claim an empty cached label list is final while refreshing", async () => {
  await render({ ...options, labels: [] }, null, true);
  await click("Filter");
  await click("Label");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading filters…");
  expect(document.body.textContent).not.toContain("No labels");
});

it("applies just one value with Only and closes the menu", async () => {
  await render({
    ...options,
    teams: [...options.teams, { id: "design", key: "DES", name: "Design" }],
  });
  await click("Filter");
  await click("Team");
  const row = [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].find((item) =>
    item.textContent?.startsWith("Design (DES)"),
  );
  const only = [...(row?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Only",
  );
  await act(async () => only!.click());
  expect(change.mock.calls.at(-1)?.[0].filters.teamIds).toEqual(["design"]);
  await act(async () => {});
  expect(document.body.textContent).not.toContain("Design (DES)");
});
