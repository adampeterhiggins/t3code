import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  pastedFilePathsAsComposerFileLinks,
  serializeComposerFileLink,
} from "./composerTrigger.ts";

describe("detectComposerTrigger", () => {
  it.each(["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "detects %s skill prefixes and their source range",
    (prefix) => {
      const text = `Use ${prefix}review`;
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "skill",
        query: "review",
        rangeStart: 4,
        rangeEnd: text.length,
      });
    },
  );
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("pastedFilePathsAsComposerFileLinks", () => {
  it.each([
    ["/tmp/parity-style/graphql-differences.jsonl", "/tmp/parity-style/graphql-differences.jsonl"],
    ["  ~/notes/todo.md\n", "~/notes/todo.md"],
    ["C:\\repo\\src\\index.ts", "C:\\repo\\src\\index.ts"],
    ["./scripts/build.sh", "./scripts/build.sh"],
    ["apps/web/src/main.tsx", "apps/web/src/main.tsx"],
    [".github/workflows/ci.yml", ".github/workflows/ci.yml"],
    ["/Users/me/My\\ Docs/plan.md", "/Users/me/My Docs/plan.md"],
    ['"/Users/me/My Docs/plan.md"', "/Users/me/My Docs/plan.md"],
    ["/Users/me/project/", "/Users/me/project"],
  ])("links the pasted path %j", (pasted, path) => {
    expect(pastedFilePathsAsComposerFileLinks(pasted)).toBe(serializeComposerFileLink(path));
  });

  it("links every line of a multi-path paste", () => {
    expect(pastedFilePathsAsComposerFileLinks("/a/one.ts\n/a/two.ts")).toBe(
      "[one.ts](/a/one.ts)\n[two.ts](/a/two.ts)",
    );
  });

  it.each([
    "/help",
    "/tmp",
    "feature/composer-chips",
    "and/or",
    "example.com/data.json",
    "https://github.com/org/repo/blob/main/a.ts",
    "cat /etc/hosts",
    "/tmp/a.txt is broken",
    "/a/one.ts\nnot a path",
    "",
  ])("leaves %j as text", (pasted) => {
    expect(pastedFilePathsAsComposerFileLinks(pasted)).toBeNull();
  });
});
