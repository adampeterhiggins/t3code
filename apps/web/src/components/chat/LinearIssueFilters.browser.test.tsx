import type { LinearFilterOptions } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import {
  DEFAULT_LINEAR_ISSUE_FILTERS,
  DEFAULT_LINEAR_ISSUE_SORT,
  LinearIssueFilterBar,
} from "./LinearIssueFilters";

const options: LinearFilterOptions = {
  teams: [{ id: "team", key: "ENG", name: "Engineering" }],
  states: [],
  projects: [],
  users: [],
  labels: [{ name: "Bug", color: "#ff0000" }],
};

function filterBar(
  props: {
    data: LinearFilterOptions | null;
    error?: string | null;
    pending?: boolean;
  },
  onRetry: () => void = () => {},
  onChange: (view: Parameters<typeof LinearIssueFilterBar>[0]["view"]) => void = () => {},
) {
  return (
    <LinearIssueFilterBar
      options={props.data}
      optionsError={props.error ?? null}
      optionsPending={props.pending ?? false}
      onRetryOptions={onRetry}
      view={{ filters: DEFAULT_LINEAR_ISSUE_FILTERS, sort: DEFAULT_LINEAR_ISSUE_SORT }}
      searching={false}
      onChange={onChange}
    />
  );
}

const status = () => document.querySelector('[role="status"]');

async function click(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>("button, [role^=menuitem]")].find(
    // Multi-select rows end with their hidden "Only" button.
    (item) => item.textContent?.trim().replace(/Only$/, "") === text,
  );
  expect(element, text).toBeDefined();
  await act(() => element!.click());
}

it("shows loading in a metadata submenu, then populates it when the request finishes", async () => {
  const change = vi.fn();
  const retry = () => {};
  await using screen = await render(filterBar({ data: null, pending: true }, retry, change));
  await click("Filter");
  await click("Team");
  expect(document.body.textContent).toContain("Loading filters…");
  await screen.rerender(filterBar({ data: options }, retry, change));
  expect(document.body.textContent).toContain("Engineering (ENG)");
  expect(document.body.textContent).not.toContain("Loading filters…");
  await click("Engineering (ENG)");
  expect(change.mock.calls[0]?.[0].filters.teamIds).toEqual(["team"]);
});

it("retries a failed request when opening filters and allows an explicit retry", async () => {
  const retry = vi.fn();
  await using screen = await render(
    filterBar({ data: null, error: "Could not reach Linear." }, retry),
  );
  expect(status()?.textContent).toContain("Could not reach Linear.");
  await click("Retry");
  expect(retry).toHaveBeenCalledTimes(1);
  await click("Filter");
  expect(retry).toHaveBeenCalledTimes(2);
  await click("Label");
  expect(document.body.textContent).toContain("Could not load filters");
  await screen.rerender(filterBar({ data: options }, retry));
  expect(status()).toBeNull();
  expect(document.body.textContent).toContain("Bug");
});

it("distinguishes an empty workspace from a request that is still loading", async () => {
  await using _screen = await render(filterBar({ data: { ...options, labels: [] } }));
  await click("Filter");
  await click("Label");
  expect(document.body.textContent).toContain("No labels");
  expect(document.body.textContent).not.toContain("Loading filters…");
});

it.each(["Assignee", "Team", "Project", "Milestone", "Status", "Label"])(
  "shows loading in the %s filter while metadata is missing",
  async (label) => {
    await using _screen = await render(filterBar({ data: null, pending: true }));
    await click("Filter");
    await click(label);
    expect(status()?.textContent).toBe("Loading filters…");
    expect(document.body.textContent).not.toContain("No milestones");
  },
);

it("keeps cached choices visible while refreshing metadata", async () => {
  await using screen = await render(filterBar({ data: options, pending: true }));
  await click("Filter");
  await click("Team");
  expect(status()?.textContent).toBe("Loading filters…");
  expect(document.body.textContent).toContain("Engineering (ENG)");
  await screen.rerender(filterBar({ data: options }));
  expect(status()).toBeNull();
});

it("does not claim an empty cached label list is final while refreshing", async () => {
  await using _screen = await render(
    filterBar({ data: { ...options, labels: [] }, pending: true }),
  );
  await click("Filter");
  await click("Label");
  expect(status()?.textContent).toBe("Loading filters…");
  expect(document.body.textContent).not.toContain("No labels");
});

it("applies just one value with Only and closes the menu", async () => {
  const change = vi.fn();
  await using _screen = await render(
    filterBar(
      {
        data: {
          ...options,
          teams: [...options.teams, { id: "design", key: "DES", name: "Design" }],
        },
      },
      () => {},
      change,
    ),
  );
  await click("Filter");
  await click("Team");
  const row = [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].find((item) =>
    item.textContent?.startsWith("Design (DES)"),
  );
  const only = [...(row?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Only",
  );
  await act(() => only!.click());
  expect(change.mock.calls.at(-1)?.[0].filters.teamIds).toEqual(["design"]);
  await vi.waitFor(() => expect(document.body.textContent).not.toContain("Design (DES)"));
});
