import { describe, expect, it } from "vite-plus/test";

import {
  openSplitPanes,
  pickSplitPartner,
  replaceSplitPane,
  splitMenuAction,
  splitPartnerKey,
  type SplitPanes,
} from "./splitViewStore";

describe("openSplitPanes", () => {
  it("puts the routed chat first when starting a split", () => {
    expect(openSplitPanes(null, "env:a", "env:b")).toEqual(["env:a", "env:b"]);
  });

  it("keeps the routed chat on its side and swaps its partner", () => {
    expect(openSplitPanes(["env:a", "env:b"], "env:b", "env:c")).toEqual(["env:c", "env:b"]);
    expect(openSplitPanes(["env:a", "env:b"], "env:a", "env:c")).toEqual(["env:a", "env:c"]);
  });

  it("replaces a split the routed chat is not part of", () => {
    expect(openSplitPanes(["env:a", "env:b"], "env:c", "env:a")).toEqual(["env:c", "env:a"]);
  });

  it("ignores opening a chat beside itself", () => {
    const panes: SplitPanes = ["env:a", "env:b"];
    expect(openSplitPanes(panes, "env:a", "env:a")).toBe(panes);
    expect(openSplitPanes(null, "env:a", "env:a")).toBeNull();
  });
});

describe("splitPartnerKey", () => {
  it("finds the other pane from either side, and nothing outside the split", () => {
    const panes: SplitPanes = ["env:a", "env:b"];
    expect(splitPartnerKey(panes, "env:a")).toBe("env:b");
    expect(splitPartnerKey(panes, "env:b")).toBe("env:a");
    expect(splitPartnerKey(panes, "env:c")).toBeNull();
    expect(splitPartnerKey(null, "env:a")).toBeNull();
    expect(splitPartnerKey(panes, null)).toBeNull();
  });
});

describe("replaceSplitPane", () => {
  it("switches only the pane whose tab menu was used", () => {
    expect(replaceSplitPane(["env:a", "env:b"], "env:b", "env:c")).toEqual(["env:a", "env:c"]);
    expect(replaceSplitPane(["env:a", "env:b"], "env:a", "env:c")).toEqual(["env:c", "env:b"]);
  });

  it("leaves the split alone when the picked tab is already on screen", () => {
    const panes: SplitPanes = ["env:a", "env:b"];
    expect(replaceSplitPane(panes, "env:a", "env:b")).toBe(panes);
    expect(replaceSplitPane(panes, "env:c", "env:d")).toBe(panes);
    expect(replaceSplitPane(null, "env:a", "env:b")).toBeNull();
  });
});

describe("pickSplitPartner", () => {
  it("prefers the most recently opened sibling tab", () => {
    expect(
      pickSplitPartner("env:a", ["env:a", "env:b", "env:c"], {
        "env:a": 30,
        "env:b": 10,
        "env:c": 20,
      }),
    ).toBe("env:c");
  });

  it("falls back to the first other tab when none was opened", () => {
    expect(pickSplitPartner("env:b", ["env:a", "env:b", "env:c"], {})).toBe("env:a");
  });

  it("has nothing to pick for a lone tab", () => {
    expect(pickSplitPartner("env:a", ["env:a"], { "env:a": 1 })).toBeNull();
    expect(pickSplitPartner("env:a", [], {})).toBeNull();
  });
});

describe("splitMenuAction", () => {
  const panes: SplitPanes = ["env:a", "env:b"];

  it("offers closing on either chat of the split on screen", () => {
    expect(splitMenuAction(panes, "env:a", "env:a")).toBe("close");
    expect(splitMenuAction(panes, "env:b", "env:a")).toBe("close");
  });

  it("offers opening any other thread beside the routed chat", () => {
    expect(splitMenuAction(panes, "env:c", "env:a")).toBe("open");
    expect(splitMenuAction(null, "env:b", "env:a")).toBe("open");
    // A stored split the routed chat is not part of is off screen.
    expect(splitMenuAction(panes, "env:a", "env:c")).toBe("open");
  });

  it("offers nothing on the routed chat outside a split, or without a routed chat", () => {
    expect(splitMenuAction(null, "env:a", "env:a")).toBeNull();
    expect(splitMenuAction(panes, "env:a", null)).toBeNull();
  });
});
