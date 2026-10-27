import { describe, expect, it } from "vite-plus/test";
import { parseNotionBlockId, parseNotionPageId } from "./notion.ts";
const id = "914a8531-daa8-4753-aacd-f01274df8ec5";
describe("Notion page references", () => {
  it("normalizes IDs and private or published page links", () => {
    for (const value of [
      id,
      id.replaceAll("-", ""),
      `https://www.notion.so/acme/Design-${id.replaceAll("-", "")}?pvs=4#block`,
      `https://acme.notion.site/Design-${id}`,
      `https://notion.so/${id}`,
      `https://app.notion.com/p/acme/Design-${id.replaceAll("-", "")}?source=copy_link`,
      `https://www.notion.com/acme/Design-${id.replaceAll("-", "")}`,
    ])
      expect(parseNotionPageId(value)).toBe(id);
  });
  it("rejects homepages, lookalike domains and unrelated URLs", () => {
    for (const value of [
      "https://notion.so",
      "https://notion.so/acme/Design",
      `https://notion.so.evil.test/${id}`,
      `https://notion.com.evil.test/${id}`,
      `https://evil.test/${id}`,
      `http://notion.so/${id}`,
      `https://user:password@notion.so/${id}`,
    ])
      expect(parseNotionPageId(value)).toBeNull();
  });
  it("reads the block a link points at", () => {
    const link =
      "https://app.notion.com/p/focaldata/Inventory-move-dev-to-staging-40699cd1efb781e9ac59e34f3d9ecea5?source=copy_link#2e0043798baf4ca5931fba9b654e6fa1";
    expect(parseNotionPageId(link)).toBe("40699cd1-efb7-81e9-ac59-e34f3d9ecea5");
    expect(parseNotionBlockId(link)).toBe("2e004379-8baf-4ca5-931f-ba9b654e6fa1");
    for (const value of [
      `https://www.notion.so/acme/Design-${id.replaceAll("-", "")}?pvs=4#block`,
      `https://www.notion.so/acme/Design-${id.replaceAll("-", "")}`,
      `https://evil.test/${id}#${id}`,
      id,
    ])
      expect(parseNotionBlockId(value)).toBeNull();
  });
});
