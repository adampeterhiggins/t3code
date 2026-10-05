import { describe, expect, it } from "vite-plus/test";

import { splitToolCallPreviewMetadata } from "./toolCallPreview";

describe("splitToolCallPreviewMetadata", () => {
  it("moves execution metadata out of the tool content", () => {
    expect(
      splitToolCallPreviewMetadata(
        "Pattern: TODO\n\nWorking directory: /repo\n\nExit code: 2\n\nError: failed",
      ),
    ).toEqual({
      body: "Pattern: TODO\n\nError: failed",
      metadata: [
        { label: "Working directory", value: "/repo" },
        { label: "Exit code", value: "2" },
      ],
    });
  });

  it("keeps diff content and metadata-looking file text intact", () => {
    const text = "Diff\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-Exit code: 0\n+Exit code: 1";
    expect(splitToolCallPreviewMetadata(text)).toEqual({ body: text, metadata: [] });
  });

  it("handles a call with only metadata", () => {
    expect(splitToolCallPreviewMetadata("Exit code: 0")).toEqual({
      body: "",
      metadata: [{ label: "Exit code", value: "0" }],
    });
  });

  it("handles calls without generated preview data", () => {
    expect(splitToolCallPreviewMetadata(undefined)).toEqual({ body: "", metadata: [] });
  });
});
