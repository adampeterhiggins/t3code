import { describe, expect, it } from "vite-plus/test";
import { boundedGoogleRange, googleDocumentMarkdown, googleGridMarkdown } from "./googleContent.ts";

describe("Google content", () => {
  it("bounds remote ranges before reading cells", () => {
    expect(boundedGoogleRange("B4:ZZ999999")).toBe("B4:AA103");
    expect(boundedGoogleRange("D6:B4")).toBeNull();
    expect(boundedGoogleRange("B4:D6")).toBe("B4:D6");
  });
  const paragraph = (text: string, headingId?: string) => ({
    paragraph: {
      elements: [{ textRun: { content: text } }],
      paragraphStyle: headingId ? { headingId, namedStyleType: "HEADING_1" } : {},
    },
  });
  it("reads nested tabs and table cells and selects a cited heading", () => {
    const document = {
      tabs: [
        {
          tabProperties: { tabId: "first" },
          documentTab: { body: { content: [paragraph("Ignore this")] } },
          childTabs: [
            {
              tabProperties: { tabId: "second" },
              documentTab: {
                body: {
                  content: [
                    paragraph("Pricing", "h.price"),
                    {
                      table: {
                        tableRows: [{ tableCells: [{ content: [paragraph("£18 per seat")] }] }],
                      },
                    },
                    paragraph("Risks", "h.risks"),
                    paragraph("Do not include"),
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const result = googleDocumentMarkdown(
      document,
      { fileId: "id", fileType: "doc", tab: "second", heading: "h.price" },
      "https://docs.google.com/document/d/id/edit",
    );
    expect(result).toContain("£18 per seat");
    expect(result).toContain("?tab=second#heading=h.price");
    expect(result).not.toContain("Ignore");
    expect(result).not.toContain("Risks");
    expect(
      googleDocumentMarkdown(
        document,
        { fileId: "id", fileType: "doc", heading: "missing" },
        "url",
      ),
    ).toBeNull();
  });
  it("preserves cell positions in ragged ranges and escapes markdown", () => {
    expect(googleGridMarkdown([["A", "B"], ["x|y"], ["line\nbreak", "2"]])).toBe(
      "| A | B |\n| --- | --- |\n| x\\|y |  |\n| line break | 2 |",
    );
  });
});
