import { describe, expect, it } from "vite-plus/test";
import { parseGoogleFileLink } from "./google.ts";

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
});
