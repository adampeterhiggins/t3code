import {
  rootRouteId,
  useRouteContext,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";

import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import {
  DesktopAppearanceCoordinator,
  FloatingEnvironmentThemeSync,
} from "../desktop/DesktopAppearanceCoordinator";
import { desktopAppearanceCoordinatorRole } from "../desktop/desktopAppearanceSession";
import { QuickMessageSignInNotice } from "../quickMessage/QuickMessageSignInNotice";
import {
  DetachedChatReadinessShell,
  DetachedChatShell,
  DetachedConnectingNotice,
  DetachedLocalEnvironmentNotice,
} from "./DetachedChatShell";
import {
  isolatedFloatingShellHasFallback,
  isolatedFloatingShellKind,
} from "./isolatedFloatingShell";

function IsolatedFloatingAppearance() {
  const role = desktopAppearanceCoordinatorRole({
    detached: true,
    authenticatedMainShell: false,
  });
  return (
    <>
      <FloatingEnvironmentThemeSync />
      {role === null ? null : <DesktopAppearanceCoordinator role={role} />}
    </>
  );
}

function IsolatedFloatingWindow(props: {
  readonly authenticated: boolean;
  readonly notFound?: ReactNode;
  readonly error?: ReactNode;
  readonly connecting?: boolean;
}) {
  const kind = isolatedFloatingShellKind({
    localEnvironmentDisabled: isLocalEnvironmentDisabled(),
    authenticated: props.authenticated,
    notFound: props.notFound !== undefined,
    error: props.error !== undefined,
    connecting: props.connecting === true,
  });
  const fallback = isolatedFloatingShellHasFallback(kind) ? (
    kind === "error" ? (
      props.error
    ) : kind === "connecting" ? (
      <DetachedConnectingNotice />
    ) : kind === "local-disabled" ? (
      <DetachedLocalEnvironmentNotice />
    ) : kind === "sign-in" ? (
      <QuickMessageSignInNotice />
    ) : (
      props.notFound
    )
  ) : undefined;
  return (
    <DetachedChatShell {...(fallback === undefined ? {} : { fallback })}>
      <IsolatedFloatingAppearance />
    </DetachedChatShell>
  );
}

function DetachedRootPendingView() {
  const rootPending = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === rootRouteId && match.status === "pending"),
  });
  // A child load with no pending view also uses this suspense fallback.
  if (!rootPending) return null;
  return <IsolatedFloatingWindow authenticated={false} connecting />;
}

/**
 * Root route options for the floating window, which stays hidden until its frame is ready.
 * pendingMinMs 0 replaces a fast session immediately; wrapInSuspense keeps pending, error and
 * not-found inside the match, and the shell is the one frame outside that boundary, so show stays
 * subscribed while those views swap.
 */
export function detachedRootRouteOptions(views: {
  readonly NotFound: ComponentType;
  readonly Error: ComponentType<ErrorComponentProps>;
}) {
  const { NotFound, Error } = views;
  return {
    pendingComponent: DetachedRootPendingView,
    pendingMs: 0,
    pendingMinMs: 0,
    wrapInSuspense: true,
    shellComponent: DetachedChatReadinessShell,
    notFoundComponent: function DetachedRootNotFoundView() {
      return <IsolatedFloatingWindow authenticated={false} notFound={<NotFound />} />;
    },
    errorComponent: function DetachedRootErrorView(props: ErrorComponentProps) {
      return <IsolatedFloatingWindow authenticated={false} error={<Error {...props} />} />;
    },
  };
}

function DetachedRootResolvedBranch() {
  const { authGateState } = useRouteContext({ from: rootRouteId });
  return <IsolatedFloatingWindow authenticated={authGateState.status === "authenticated"} />;
}

/** The floating window's root branch, in place of the main window's app shell. */
export function DetachedRootBranch(props: { readonly NotFound: ComponentType }) {
  const { NotFound } = props;
  const rootGlobalNotFound = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === rootRouteId && match.globalNotFound === true),
  });
  // beforeLoad notFound leaves the root match successful with an empty context
  // so the shell can render. Reading auth here throws and the error page wins.
  if (rootGlobalNotFound) {
    return (
      <>
        <IsolatedFloatingAppearance />
        <NotFound />
      </>
    );
  }
  return <DetachedRootResolvedBranch />;
}
