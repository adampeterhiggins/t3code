export type IsolatedFloatingShellKind =
  | "local-disabled"
  | "sign-in"
  | "chat"
  | "not-found"
  | "error"
  | "connecting";

/**
 * Notices, connecting, the router error, and the fail-closed page stay in the
 * readiness frame and do not mount routed chat. Error and connecting come
 * before sign-in, while the session request has not settled.
 */
export function isolatedFloatingShellKind(input: {
  readonly localEnvironmentDisabled: boolean;
  readonly authenticated: boolean;
  readonly notFound?: boolean;
  readonly error?: boolean;
  readonly connecting?: boolean;
}): IsolatedFloatingShellKind {
  if (input.error === true) return "error";
  if (input.connecting === true) return "connecting";
  if (input.notFound === true) return "not-found";
  if (input.localEnvironmentDisabled) return "local-disabled";
  if (!input.authenticated) return "sign-in";
  return "chat";
}

export function isolatedFloatingShellHasFallback(kind: IsolatedFloatingShellKind): boolean {
  return kind !== "chat";
}

/**
 * The root readiness shell mounts the frame for every kind. The navigation
 * guard wraps routed chat only, so a notice can mark the panel ready.
 */
export function detachedChatShellPlan(hasFallback: boolean): {
  readonly frame: true;
  readonly guardWrapsRoutedChildren: boolean;
} {
  return {
    frame: true,
    guardWrapsRoutedChildren: !hasFallback,
  };
}

/**
 * Subscribe to show events and mark the panel ready. A missing bridge leaves
 * the window hidden until a later shell provides one; it does not throw.
 */
export function activateDetachedChatFrame<Event>(
  bridge:
    | {
        readonly onShow: (listener: (event: Event) => void) => () => void;
        readonly setPanelReady: () => Promise<void>;
      }
    | null
    | undefined,
  onShow: (event: Event) => void,
): () => void {
  if (bridge == null) return () => {};
  const unsubscribe = bridge.onShow(onShow);
  void bridge.setPanelReady().catch(() => undefined);
  return unsubscribe;
}
