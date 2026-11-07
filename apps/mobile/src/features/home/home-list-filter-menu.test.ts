import { describe, expect, it, vi } from "vite-plus/test";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";

function select(item: AppBarMenuItem | undefined) {
  if (item && "onPress" in item) item.onPress?.();
}

import { availableThreadListPages } from "../threads/threadListV2";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

describe("buildHomeListFilterMenuItems", () => {
  it("adds a multi-select Show submenu with group pages after Threads", () => {
    const onTogglePage = vi.fn();
    const build = (hidingSupported: boolean) =>
      buildHomeListFilterMenuItems({
        environments: [],
        projects: [],
        selectedEnvironmentId: null,
        selectedProjectKey: null,
        onEnvironmentChange: vi.fn(),
        onProjectChange: vi.fn(),
        pages: ["threads", "group:Ops", "settled"],
        availablePages: availableThreadListPages({ hidingSupported, groupNames: ["Ops", "Web"] }),
        onTogglePage,
        organisations: [],
        organisationKeys: [],
        onToggleOrganisation: vi.fn(),
        onClearOrganisations: vi.fn(),
      }).find((item) => item.title === "Show");

    const show = build(true);
    expect(show).toMatchObject({
      items: [
        { title: "Threads", selected: true },
        { title: "Ops", selected: true },
        { title: "Web", selected: false },
        { title: "Automations", selected: false },
        { title: "Snoozed", selected: false },
        { title: "Hidden", selected: false },
        { title: "Settled", selected: true },
      ],
    });
    if (!show || !("items" in show)) throw new Error("Expected show submenu");
    select(show.items[2]);
    select(show.items[5]);
    expect(onTogglePage).toHaveBeenNthCalledWith(1, "group:Web");
    expect(onTogglePage).toHaveBeenNthCalledWith(2, "hidden");
    expect(build(false)).toMatchObject({
      items: [
        { title: "Threads" },
        { title: "Ops" },
        { title: "Web" },
        { title: "Automations" },
        { title: "Snoozed" },
        { title: "Settled" },
      ],
    });
  });

  it("adds an Organisations multi-select before Project", () => {
    const onToggleOrganisation = vi.fn();
    const onClearOrganisations = vi.fn();
    const menu = buildHomeListFilterMenuItems({
      environments: [],
      projects: [{ key: "environment-1:project-1", label: "App" }],
      selectedEnvironmentId: null,
      selectedProjectKey: null,
      onEnvironmentChange: vi.fn(),
      onProjectChange: vi.fn(),
      pages: ["threads"],
      availablePages: ["threads", "snoozed", "settled"],
      onTogglePage: vi.fn(),
      organisations: [
        { key: "github.com/acme", label: "acme" },
        { key: "github.com/zed", label: "zed" },
      ],
      organisationKeys: ["github.com/zed"],
      onToggleOrganisation,
      onClearOrganisations,
    });
    const titles = menu.map((item) => item.title);
    expect(titles.indexOf("Organisations")).toBe(titles.indexOf("Project") - 1);
    const organisationsMenu = menu.find((item) => item.title === "Organisations");
    expect(organisationsMenu).toMatchObject({
      items: [
        { title: "All organisations", selected: false },
        { title: "acme", selected: false },
        { title: "zed", selected: true },
      ],
    });
    if (!organisationsMenu || !("items" in organisationsMenu))
      throw new Error("Expected organisations submenu");
    select(organisationsMenu.items[1]);
    select(organisationsMenu.items[0]);
    expect(onToggleOrganisation).toHaveBeenCalledWith("github.com/acme");
    expect(onClearOrganisations).toHaveBeenCalled();
  });
});
