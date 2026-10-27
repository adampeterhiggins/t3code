import type { ComponentProps } from "react";
import type { Project } from "../../types";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { CheckoutAttachPickerHost } from "./CheckoutAttachPicker";
import { LinearIssuePickerHost } from "./LinearIssuePicker";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { PullRequestAttachPickerHost } from "./PullRequestAttachPicker";
import { QuickMessageDraftApplier } from "../desktop/QuickMessageDraftApplier";
import { RepositoryAttachPickerHost } from "./RepositoryAttachPicker";
import { StartFromPickerHost } from "./StartFromPicker";
import { ThreadAttachPickerHost } from "./ThreadAttachPicker";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import { type DraftThreadEnvMode } from "../../composerDraftStore";

export function ChatViewIntegrationHosts(input: {
  activeWorktreePath: string | null;
  sendEnvMode: DraftThreadEnvMode;
  activeProjectCwd: string | null;
  supportsPullRequests: boolean;
  activeProject: Project | null;
  canCheckoutPullRequestIntoThread: boolean;
  activeProjectRef: ScopedProjectRef | null;
  routeThreadRef: ScopedThreadRef;
  pointDraftAtCheckout: NonNullable<ComponentProps<typeof StartFromPickerHost>["onCheckout"]>;
  readAutomationSource: NonNullable<
    ComponentProps<typeof StartFromPickerHost>["readAutomationSource"]
  >;
  isLocalDraftThread: boolean;
}) {
  const {
    activeWorktreePath,
    sendEnvMode,
    activeProjectCwd,
    supportsPullRequests,
    activeProject,
    canCheckoutPullRequestIntoThread,
    activeProjectRef,
    routeThreadRef,
    pointDraftAtCheckout,
    readAutomationSource,
    isLocalDraftThread,
  } = input;
  return (
    <>
      <LinearIssuePickerHost />
      <ThreadAttachPickerHost />
      <CheckoutAttachPickerHost />
      <RepositoryAttachPickerHost
        workspaceCwd={activeWorktreePath ?? (sendEnvMode === "worktree" ? null : activeProjectCwd)}
      />
      {supportsPullRequests && activeProject ? (
        <PullRequestAttachPickerHost
          environmentId={activeProject.environmentId}
          projectId={activeProject.id}
        />
      ) : null}
      {canCheckoutPullRequestIntoThread && activeProject && activeProjectRef ? (
        <StartFromPickerHost
          environmentId={activeProject.environmentId}
          projectRef={activeProjectRef}
          projectId={activeProject.id}
          workspaceRoot={activeProject.workspaceRoot}
          githubIssuesAvailable={isGitHubProject(activeProject)}
          threadRef={routeThreadRef}
          onCheckout={pointDraftAtCheckout}
          readAutomationSource={readAutomationSource}
        />
      ) : null}
      {isLocalDraftThread && activeProject ? (
        <QuickMessageDraftApplier
          environmentId={activeProject.environmentId}
          workspaceRoot={activeProject.workspaceRoot}
          threadRef={routeThreadRef}
          onCheckout={pointDraftAtCheckout}
        />
      ) : null}
    </>
  );
}
