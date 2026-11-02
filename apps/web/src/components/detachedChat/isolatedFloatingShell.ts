export type IsolatedFloatingShellKind = "local-disabled" | "sign-in" | "chat" | "not-found";

/**
 * What the isolated window may paint. Notices and the fail-closed page are
 * fallbacks: they still sit in the readiness frame, and they do not mount the
 * routed chat.
 */
export function isolatedFloatingShellKind(input: {
  readonly localEnvironmentDisabled: boolean;
  readonly authenticated: boolean;
  readonly notFound?: boolean;
}): IsolatedFloatingShellKind {
  if (input.notFound === true) return "not-found";
  if (input.localEnvironmentDisabled) return "local-disabled";
  if (!input.authenticated) return "sign-in";
  return "chat";
}

export function isolatedFloatingShellHasFallback(kind: IsolatedFloatingShellKind): boolean {
  return kind !== "chat";
}

/**
 * The frame is always mounted. The navigation guard wraps routed chat only,
 * so a notice or a fail-closed page can still mark the panel ready.
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
