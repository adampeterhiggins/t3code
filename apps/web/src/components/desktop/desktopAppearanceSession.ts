import type { ClientSettings, DesktopAppearanceSnapshot } from "@t3tools/contracts";

export type DesktopAppearanceCoordinatorRole = "main" | "floating";

/**
 * The optional appearance and client-settings methods on `DesktopBridge`.
 * Older shells omit them; a missing method leaves the local theme engine alone.
 */
export interface DesktopAppearanceTransport {
  readonly getAppearanceSnapshot?: () => Promise<DesktopAppearanceSnapshot | null>;
  readonly publishAppearanceSnapshot?: (snapshot: DesktopAppearanceSnapshot) => Promise<void>;
  readonly onAppearanceSnapshot?: (
    listener: (snapshot: DesktopAppearanceSnapshot) => void,
  ) => () => void;
  readonly getClientSettings?: () => Promise<ClientSettings | null>;
  readonly onClientSettings?: (listener: (settings: ClientSettings) => void) => () => void;
}

export interface DesktopAppearanceSession {
  readonly role: DesktopAppearanceCoordinatorRole;
  readonly bridge: DesktopAppearanceTransport | null | undefined;
  readonly readCommitted: () => DesktopAppearanceSnapshot;
  readonly subscribeCommitted: (listener: () => void) => () => void;
  readonly adoptAppearance: (snapshot: unknown) => void;
  readonly adoptSettings: (settings: ClientSettings) => void;
}

function adoptSnapshot(
  adoptAppearance: (snapshot: unknown) => void,
  snapshot: DesktopAppearanceSnapshot,
): void {
  try {
    adoptAppearance(snapshot);
  } catch {
    // A snapshot the theme engine rejects stays off the painted palette.
  }
}

/**
 * Main publishes each committed snapshot in order. Floating subscribes before
 * its initial read, so a snapshot that arrives while that read is in flight
 * is not replaced by the older result. Neither path writes a reflected snapshot.
 */
export function startDesktopAppearanceSession(input: DesktopAppearanceSession): () => void {
  let stopped = false;
  const stops: Array<() => void> = [];
  const stop = () => {
    stopped = true;
    for (const unsubscribe of stops.splice(0)) unsubscribe();
  };

  if (input.role === "main") {
    const publish = input.bridge?.publishAppearanceSnapshot;
    if (typeof publish !== "function") return () => {};
    let tail = Promise.resolve();
    const enqueue = (snapshot: DesktopAppearanceSnapshot) => {
      tail = tail.then(() => {
        if (stopped) return undefined;
        return Promise.resolve(publish(snapshot)).then(
          () => undefined,
          () => undefined,
        );
      });
    };
    const publishCommitted = () => {
      if (stopped) return;
      try {
        enqueue(input.readCommitted());
      } catch {
        // A failed preference read must not replace the stored snapshot.
      }
    };
    stops.push(input.subscribeCommitted(publishCommitted));
    publishCommitted();
    return stop;
  }

  const bridge = input.bridge;
  const getAppearance = bridge?.getAppearanceSnapshot;
  const onAppearance = bridge?.onAppearanceSnapshot;
  if (typeof getAppearance === "function" && typeof onAppearance === "function") {
    let revision = 0;
    const seen = revision;
    stops.push(
      onAppearance((snapshot) => {
        revision += 1;
        if (stopped) return;
        adoptSnapshot(input.adoptAppearance, snapshot);
      }),
    );
    void getAppearance().then(
      (snapshot) => {
        if (stopped || revision !== seen || snapshot === null) return;
        adoptSnapshot(input.adoptAppearance, snapshot);
      },
      () => undefined,
    );
  }

  const getSettings = bridge?.getClientSettings;
  const onSettings = bridge?.onClientSettings;
  if (typeof getSettings === "function" && typeof onSettings === "function") {
    let revision = 0;
    const seen = revision;
    stops.push(
      onSettings((settings) => {
        revision += 1;
        if (stopped) return;
        input.adoptSettings(settings);
      }),
    );
    void getSettings().then(
      (settings) => {
        if (stopped || revision !== seen || settings === null) return;
        input.adoptSettings(settings);
      },
      () => undefined,
    );
  }

  return stop;
}
