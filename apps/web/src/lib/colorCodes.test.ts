import { describe, expect, it } from "vite-plus/test";
import { COLOR_CODE, describeColorCode, wholeColorCode } from "./colorCodes";

describe("COLOR_CODE", () => {
  it("finds 3, 4, 6 and 8 digit hex colours, including all-digit ones", () => {
    expect("#fff, #0008 then #F2EDE5, #333333 and #1f6feb80.".match(COLOR_CODE)).toEqual([
      "#fff",
      "#0008",
      "#F2EDE5",
      "#333333",
      "#1f6feb80",
    ]);
  });

  it("leaves fragments, entities and anchors alone", () => {
    expect("page#abc &#abc; #abc-def #abcde #abcdefabc acme/web#bad".match(COLOR_CODE)).toBeNull();
  });
});

describe("wholeColorCode", () => {
  it("accepts inline code that is only a colour", () => {
    expect(wholeColorCode(" #E5484D ")).toBe("#E5484D");
    expect(wholeColorCode("color: #E5484D")).toBeNull();
    expect(wholeColorCode("#123")).toBeNull();
    expect(wholeColorCode("#0a0")).toBe("#0a0");
  });
});

describe("describeColorCode", () => {
  it("expands short forms and reports contrast", () => {
    expect(describeColorCode("#fff")).toEqual({
      rgb: "255 255 255",
      hsl: "0 0% 100%",
      contrastOnWhite: "1.00",
      contrastOnBlack: "21.00",
      prefersDarkText: true,
    });
    expect(describeColorCode("#0008")).toMatchObject({
      rgb: "0 0 0 / 53%",
      prefersDarkText: false,
    });
    expect(describeColorCode("#1F6FEB").hsl).toBe("216 84% 52%");
  });
});
