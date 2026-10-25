import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ComposerContextRecord } from "./composerContext.ts";
import { parseGoogleFileLink } from "./google.ts";

const decodeContextRecord = Schema.decodeUnknownSync(ComposerContextRecord);

describe("parseGoogleFileLink", () => {
  it("keeps heading and tab selectors for document citations", () => {
    expect(
      parseGoogleFileLink(
        "https://docs.google.com/document/d/abc_123/edit?tab=t.a#heading=h.pricing",
      ),
    ).toEqual({
      fileId: "abc_123",
      fileType: "doc",
      tab: "t.a",
      heading: "h.pricing",
    });
  });
  it("keeps sheet ranges without treating other origins as Google", () => {
    expect(
      parseGoogleFileLink("https://docs.google.com/spreadsheets/d/abc-123/edit#gid=42&range=B2:D5"),
    ).toEqual({
      fileId: "abc-123",
      fileType: "sheet",
      gid: "42",
      range: "B2:D5",
    });
    for (const url of [
      "http://docs.google.com/document/d/id",
      "https://docs.google.com.evil.test/document/d/id",
      "https://me@docs.google.com/document/d/id",
      "https://docs.google.com/document/d/id#heading=",
    ]) {
      expect(parseGoogleFileLink(url)).toBeNull();
    }
  });

  it("parses Drive files and folders and Calendar event links", () => {
    expect(parseGoogleFileLink("https://drive.google.com/file/d/report-1/view")).toEqual({
      fileId: "report-1",
      fileType: "drive",
    });
    expect(parseGoogleFileLink("https://drive.google.com/drive/u/0/folders/folder-1")).toEqual({
      fileId: "folder-1",
      fileType: "folder",
    });
    expect(parseGoogleFileLink("https://drive.google.com/open?id=report-1")).toEqual({
      fileId: "report-1",
      fileType: "drive",
    });
    const eid = btoa("event123 team@example.com");
    expect(parseGoogleFileLink(`https://calendar.google.com/calendar/event?eid=${eid}`)).toEqual({
      fileId: `https://calendar.google.com/calendar/event?eid=${eid}`,
      fileType: "event",
      calendarId: "team@example.com",
      eventId: "event123",
    });
    expect(
      parseGoogleFileLink(`https://calendar.google.com/calendar/u/0/r/eventedit/${eid}`)?.eventId,
    ).toBe("event123");
    expect(
      parseGoogleFileLink("https://calendar.google.com/calendar/event?eid=invalid"),
    ).toBeNull();
    expect(parseGoogleFileLink("https://drive.google.com/open?id=a&id=b")).toBeNull();
    expect(parseGoogleFileLink("https://drive.google.com.evil.test/file/d/id")).toBeNull();
  });
});

describe("Google context records", () => {
  it("decodes a Calendar event chip, whose id is its full event URL", () => {
    const url = `https://calendar.google.com/calendar/event?eid=${btoa(`launch-review-${"x".repeat(120)} team@example.com`)}`;
    const record = {
      version: 1,
      kind: "google-file",
      contextId: "google-file_event_1",
      label: "Launch review",
      fileType: "event",
      fileId: url,
      title: "Launch review",
      url,
      markdown: "Start: 2026-10-26",
    };
    expect(url.length).toBeGreaterThan(128);
    expect(decodeContextRecord(record)).toEqual(record);
  });
});
