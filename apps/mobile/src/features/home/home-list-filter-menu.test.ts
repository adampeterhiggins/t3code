import { describe, expect, it, vi } from "vite-plus/test";

import { availableThreadListPages } from "../threads/threadListV2";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";

describe("buildHomeListFilterMenu", () => {
  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const menu = buildHomeListFilterMenu({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething" },
        { key: "environment-1:project-2", label: "Website" },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-1",
      onEnvironmentChange: vi.fn(),
      onProjectChange,
      pages: ["threads"],
      availablePages: ["threads", "snoozed", "settled"],
      onTogglePage: vi.fn(),
      organisations: [],
      organisationKeys: [],
      onToggleOrganisation: vi.fn(),
      onClearOrganisations: vi.fn(),
    });

    const projectMenu = menu.items.find(
      (item) => item.type === "submenu" && item.title === "Project",
    );
    expect(menu.items.some((item) => item.title === "Settings")).toBe(false);
    expect(projectMenu).toMatchObject({
      type: "submenu",
      items: [
        { title: "All projects", state: "off" },
        { title: "Codething", state: "on" },
        { title: "Website", state: "off" },
      ],
    });
    if (projectMenu?.type !== "submenu") throw new Error("Expected project submenu");

    projectMenu.items[0]?.onPress();
    projectMenu.items[2]?.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");
  });

  it("adds a multi-select Show submenu with group pages after Threads", () => {
    const onTogglePage = vi.fn();
    const build = (hidingSupported: boolean) =>
      buildHomeListFilterMenu({
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
      }).items.find((item) => item.type === "submenu" && item.title === "Show");

    const show = build(true);
    expect(show).toMatchObject({
      items: [
        { title: "Threads", state: "on" },
        { title: "Ops", state: "on" },
        { title: "Web", state: "off" },
        { title: "Snoozed", state: "off" },
        { title: "Hidden", state: "off" },
        { title: "Settled", state: "on" },
      ],
    });
    if (show?.type !== "submenu") throw new Error("Expected show submenu");
    show.items[2]?.onPress();
    show.items[4]?.onPress();
    expect(onTogglePage).toHaveBeenNthCalledWith(1, "group:Web");
    expect(onTogglePage).toHaveBeenNthCalledWith(2, "hidden");
    expect(build(false)).toMatchObject({
      items: [
        { title: "Threads" },
        { title: "Ops" },
        { title: "Web" },
        { title: "Snoozed" },
        { title: "Settled" },
      ],
    });
  });

  it("adds an Organisations multi-select before Project", () => {
    const onToggleOrganisation = vi.fn();
    const onClearOrganisations = vi.fn();
    const menu = buildHomeListFilterMenu({
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
    const titles = menu.items.map((item) => item.title);
    expect(titles.indexOf("Organisations")).toBe(titles.indexOf("Project") - 1);
    const organisationsMenu = menu.items.find((item) => item.title === "Organisations");
    expect(organisationsMenu).toMatchObject({
      items: [
        { title: "All organisations", state: "off" },
        { title: "acme", state: "off" },
        { title: "zed", state: "on" },
      ],
    });
    if (organisationsMenu?.type !== "submenu") throw new Error("Expected organisations submenu");
    organisationsMenu.items[1]?.onPress();
    organisationsMenu.items[0]?.onPress();
    expect(onToggleOrganisation).toHaveBeenCalledWith("github.com/acme");
    expect(onClearOrganisations).toHaveBeenCalled();
  });
});
