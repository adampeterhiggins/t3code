import type { DesktopMainDestinationResult, ScopedThreadRef } from "@t3tools/contracts";

import { randomUUID } from "../../lib/utils";
import { stackedThreadToast, toastManager } from "../ui/toast";

function toastFailure(title: string, description: string) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

export function toastMainDestinationFailure(): void {
  toastFailure("Couldn't open the main window", "The draft in this window was left as it is.");
}

export function toastAutomationSeedFailure(): void {
  toastFailure("Couldn't move this automation", "The new automation draft stays in this window.");
}

async function invoke<Request extends { readonly requestId: string }>(
  request: Request,
  open: ((request: Request) => Promise<DesktopMainDestinationResult> | undefined) | undefined,
  notifyFailure: () => void,
): Promise<DesktopMainDestinationResult> {
  if (open === undefined) {
    notifyFailure();
    return { requestId: request.requestId, status: "failed" };
  }
  try {
    const result = await open(request);
    if (result === undefined || result.status === "failed") {
      notifyFailure();
      return { requestId: request.requestId, status: "failed" };
    }
    return result;
  } catch {
    notifyFailure();
    return { requestId: request.requestId, status: "failed" };
  }
}

/** Presentation entry for an explicit Open in main action. Does not touch the draft. */
export function openMainThread(
  thread: ScopedThreadRef,
  deps: {
    readonly open: (request: {
      requestId: string;
      thread: ScopedThreadRef;
    }) => Promise<DesktopMainDestinationResult> | undefined;
    readonly notifyFailure?: () => void;
    readonly requestId?: string;
  },
): Promise<DesktopMainDestinationResult> {
  const requestId = deps.requestId ?? randomUUID();
  return invoke(
    { requestId, thread },
    deps.open,
    deps.notifyFailure ?? toastMainDestinationFailure,
  );
}

export function openMainLocation(
  href: string,
  deps: {
    readonly open: (request: {
      requestId: string;
      href: string;
    }) => Promise<DesktopMainDestinationResult> | undefined;
    readonly notifyFailure?: () => void;
    readonly requestId?: string;
  },
): Promise<DesktopMainDestinationResult> {
  const requestId = deps.requestId ?? randomUUID();
  return invoke({ requestId, href }, deps.open, deps.notifyFailure ?? toastMainDestinationFailure);
}
