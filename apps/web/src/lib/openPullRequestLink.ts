import type {
  EnvironmentId,
  ScopedThreadRef,
  ExecutionEnvironmentCapabilities,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent } from "react";

import {
  resolveChangeRequestLinkTarget,
  resolvePullRequestPreviewTarget as resolveSharedPullRequestPreviewTarget,
  findProjectOnChangeRequestHost,
} from "@t3tools/client-runtime/change-request-links";

import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

import { useOpenLink } from "../browser/useOpenLink";
import { useClientSettings } from "../hooks/useSettings";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useRightPanelStore } from "../rightPanelStore";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, useProjects } from "../state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { usePrimaryEnvironmentId } from "../state/environments";

export function resolvePullRequestPreviewTarget({
  capabilities,
  ...input
}: Omit<Parameters<typeof resolveSharedPullRequestPreviewTarget>[0], "pullRequestsEnabled"> & {
  capabilities:
    | Pick<ExecutionEnvironmentCapabilities, "pullRequests" | "threadPullRequests">
    | undefined;
}) {
  const own = resolveSharedPullRequestPreviewTarget({
    ...input,
    pullRequestsEnabled: capabilities?.pullRequests === true,
  });
  if (
    own !== null ||
    capabilities?.pullRequests !== true ||
    capabilities.threadPullRequests !== true ||
    input.environmentId === null
  )
    return own;
  const parsed = sourceControlClients.parseChangeRequestUrl(input.url)?.link;
  if (parsed === undefined) return null;
  const project = findProjectOnChangeRequestHost(
    input.projects.filter((project) => project.environmentId === input.environmentId),
    parsed,
  );
  if (project === undefined) return null;
  return {
    environmentId: input.environmentId,
    input: {
      projectId: project.id,
      host: parsed.authority ?? parsed.host,
      repository: parsed.repository,
      number: parsed.number,
    },
  };
}

export function usePullRequestPreviewTarget(environmentId: EnvironmentId | null, url: string) {
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return resolvePullRequestPreviewTarget({
    environmentId,
    projects,
    capabilities: serverConfig?.environment.capabilities,
    url,
  });
}

function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey"> &
    Partial<Pick<MouseEvent<HTMLElement>, "button">>,
): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function useOpenChangeRequestLink(
  threadRef?: ScopedThreadRef,
  panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  >,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetEnvironmentId?: EnvironmentId,
) => boolean {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  return (event, targetUrl, targetThreadRef, targetEnvironmentId) => {
    if (!openInApp || shouldOpenPullRequestExternally(event)) return false;
    // Read at click time: every provider status push replaces the config map, and
    // subscribing would hand every rendered link a new handler. Projects likewise, so a
    // link can resolve against a snapshot that arrived after this handler was built.
    const serverConfigs = appAtomRegistry.get(environmentServerConfigsAtom);
    const resolvedThreadRef = targetThreadRef ?? threadRef;
    const resolvedPanelRef = panelRef ?? resolvedThreadRef;
    const target = resolveChangeRequestLinkTarget({
      url: targetUrl,
      projects: readProjects(),
      capabilities: (environmentId) => serverConfigs.get(environmentId)?.environment.capabilities,
      environmentId: resolvedThreadRef?.environmentId ?? targetEnvironmentId,
      primaryEnvironmentId,
      lendHostProject: resolvedPanelRef !== undefined,
    });
    if (target === null) return false;
    const { project, repository, number, host } = target;
    event.preventDefault();
    event.stopPropagation();
    const pullRequestsSearch = {
      repository,
      number,
      ...(host === undefined ? {} : { selectedHost: host }),
      selectedProjectId: project.id,
      selectedEnvironmentId: project.environmentId,
    };
    if (resolvedPanelRef) {
      useRightPanelStore.getState().openPullRequest(resolvedPanelRef, {
        // The standalone PR panel has a synthetic ref; each tab keeps its real environment.
        ...(resolvedPanelRef.environmentId === project.environmentId
          ? {}
          : { environmentId: project.environmentId }),
        projectId: project.id,
        ...(host === undefined ? {} : { host }),
        repository,
        url: targetUrl,
        number,
      });
      if (!resolvedThreadRef) {
        void navigate({
          to: "/pull-requests",
          search: (previous) => ({
            ...previous,
            involvement: previous.involvement ?? "all",
            state: previous.state ?? "all",
            ...pullRequestsSearch,
          }),
          replace: true,
        });
      }
      return true;
    }
    void navigate({
      to: "/pull-requests",
      search: { involvement: "all", state: "all", ...pullRequestsSearch },
    });
    return true;
  };
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    const openInBrowser = shouldOpenPullRequestExternally(event);
    const isAnchor =
      event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
    // Native links handle modified clicks; buttons still need openExternal.
    if (openInBrowser && isAnchor) return false;

    event.preventDefault();
    if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

    void openLink(prUrl, { event, threadRef: targetThreadRef }).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
    return false;
  };
}

/**
 * Opens the thread's own pull request (the details panel rows and the composer badge) where
 * Settings → General → Open pull requests in says. "Side panel" is useOpenPrLink. "Browser"
 * swaps the two: a click goes to the browser "Open links in" picks, and Cmd/Ctrl-click opens
 * the side panel, so the other destination stays one modifier away.
 */
export function usePreferredOpenPrLink(threadRef?: ScopedThreadRef) {
  const openPrLink = useOpenPrLink(threadRef);
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  const target = useClientSettings((settings) => settings.pullRequestOpenTarget);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (target !== "browser") return openPrLink(event, prUrl, targetThreadRef);
    event.stopPropagation();
    event.preventDefault();
    if (shouldOpenPullRequestExternally(event)) {
      const panelEvent = {
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        metaKey: false,
        ctrlKey: false,
      };
      if (openChangeRequest(panelEvent, prUrl, targetThreadRef)) return true;
    }
    void openLink(prUrl, { threadRef: targetThreadRef }).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
    return false;
  };
}
