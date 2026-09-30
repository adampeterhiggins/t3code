import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createThreadAttachSummaryLoader } from "./threadAttachPickerSummary";

const threadId = ThreadId.make("source-thread");

describe("thread attachment summary snapshots", () => {
  it("shares an in-flight request between preview and attachment and retains the previewed snapshot", async () => {
    let resolveSummary = (_summary: string) => {};
    const fetchSummary = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSummary = resolve;
        }),
    );
    const load = createThreadAttachSummaryLoader(fetchSummary);
    const preview = load(threadId);
    const attachment = load(threadId);
    expect(attachment).toBe(preview);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    resolveSummary("The previewed conversation");
    expect(await attachment).toBe("The previewed conversation");
    expect(load(threadId)).toBe(preview);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it("allows a failed preview to be retried when selecting or hovering again", async () => {
    const fetchSummary = vi
      .fn<(id: ThreadId) => Promise<string>>()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce("Restored conversation");
    const load = createThreadAttachSummaryLoader(fetchSummary);
    await expect(load(threadId)).rejects.toThrow("Disconnected");
    await expect(load(threadId)).resolves.toBe("Restored conversation");
    expect(fetchSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps different threads' snapshots separate", async () => {
    const fetchSummary = vi.fn(async (id: ThreadId) => `Summary of ${id}`);
    const load = createThreadAttachSummaryLoader(fetchSummary);
    const otherThreadId = ThreadId.make("other-thread");
    expect(await load(threadId)).toBe("Summary of source-thread");
    expect(await load(otherThreadId)).toBe("Summary of other-thread");
    expect(fetchSummary).toHaveBeenCalledTimes(2);
  });
});
