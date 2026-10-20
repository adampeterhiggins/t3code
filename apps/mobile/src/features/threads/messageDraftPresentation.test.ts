import { describe, expect, it } from "vite-plus/test";

import {
  defaultMessageDraftSendMode,
  messageDraftRowPresentation,
} from "./messageDraftPresentation";

describe("defaultMessageDraftSendMode", () => {
  it("sends plainly while idle and follows the follow-up preference while running", () => {
    expect(
      defaultMessageDraftSendMode({ running: false, canSteer: true, followUpBehavior: "steer" }),
    ).toBe("auto");
    expect(
      defaultMessageDraftSendMode({ running: true, canSteer: true, followUpBehavior: "steer" }),
    ).toBe("steer");
  });

  it("queues when the provider cannot steer the running turn", () => {
    expect(
      defaultMessageDraftSendMode({ running: true, canSteer: false, followUpBehavior: "steer" }),
    ).toBe("queue");
  });
});

describe("messageDraftRowPresentation", () => {
  it("names attachment-only drafts and hides provenance for drafts saved on mobile", () => {
    expect(
      messageDraftRowPresentation({ text: "  ", attachments: [{}, {}], origin: "mobile" }),
    ).toEqual({ title: "Attachments", attachmentCount: 2, originLabel: null });
  });

  it("uses the first line and says where the draft came from", () => {
    expect(
      messageDraftRowPresentation({
        text: "Check the flaky test\nmore detail",
        attachments: [],
        origin: "agent",
      }),
    ).toEqual({ title: "Check the flaky test", attachmentCount: 0, originLabel: "Agent" });
  });
});
