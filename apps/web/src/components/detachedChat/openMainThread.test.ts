import { DesktopMainDestinationRequest, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../ui/toast";
import { openExpandedThreadInMain } from "./openMainThread";

const decodeRequest = Schema.decodeUnknownSync(DesktopMainDestinationRequest);
const thread = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("open in main", () => {
  it("sends the server thread and leaves the floating route and draft alone", async () => {
    const floating = { pathname: "/env-1/thread-1", prompt: "keep this" };
    const opened: unknown[] = [];
    const result = await openExpandedThreadInMain(thread, {
      open: async (request) => {
        opened.push(request);
        return { requestId: request.requestId, status: "opened" };
      },
      requestId: "request-1",
    });

    expect(result).toMatchObject({ requestId: "request-1", status: "opened" });
    expect(decodeRequest(opened[0])).toMatchObject({ requestId: "request-1", thread });
    expect(opened[0]).not.toHaveProperty("href");
    expect(floating).toEqual({ pathname: "/env-1/thread-1", prompt: "keep this" });
  });

  it("does not call the bridge when there is no server thread", async () => {
    const open = vi.fn();
    await expect(openExpandedThreadInMain(null, { open })).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("toasts when the main window does not take the thread", async () => {
    const add = vi.spyOn(toastManager, "add").mockImplementation(() => "toast");
    const floating = { prompt: "still here" };

    await expect(
      openExpandedThreadInMain(thread, {
        open: async (request) => ({ requestId: request.requestId, status: "failed" }),
        requestId: "request-2",
      }),
    ).resolves.toMatchObject({ status: "failed" });

    expect(floating.prompt).toBe("still here");
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      title: "Couldn't open the main window",
      description: "The draft in this window was left as it is.",
    });
  });
});
