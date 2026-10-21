import type { DesktopAppearanceSnapshot } from "@t3tools/contracts";

type AppearanceListener = () => void;

const committedAppearanceListeners = new Set<AppearanceListener>();

let presentedAppearance: DesktopAppearanceSnapshot | null = null;

export function subscribeCommittedAppearanceChanges(listener: AppearanceListener): () => void {
  committedAppearanceListeners.add(listener);
  return () => {
    committedAppearanceListeners.delete(listener);
  };
}

/** Local preference and custom-theme library writes. Preview must not call this. */
export function notifyCommittedAppearanceChange(): void {
  for (const listener of committedAppearanceListeners) listener();
}

export function readPresentedAppearance(): DesktopAppearanceSnapshot | null {
  return presentedAppearance;
}

export function isPresentedAppearanceActive(): boolean {
  return presentedAppearance !== null;
}

export function setPresentedAppearanceSnapshot(snapshot: DesktopAppearanceSnapshot | null): void {
  presentedAppearance = snapshot;
}
