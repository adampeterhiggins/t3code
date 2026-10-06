import { describe, expect, it } from "vite-plus/test";
import { parseNotionPageId } from "./notion.ts";
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
});
