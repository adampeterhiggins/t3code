import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { devinReviewContextRecord } from "@t3tools/client-runtime/state/devinReview";
import type {
  DevinReviewContext,
  DevinReviewFinding,
  DevinReviewSummary,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { msg, T, useGT, useMessages } from "gt-react";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { ArrowLeftIcon } from "lucide-react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useIssueContextStore } from "~/issueContextStore";
import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { devinReviewEnvironment } from "~/state/devinReview";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { DevinReviewContent, DevinReviewToolbar } from "./DevinReviewBody";
import {
  devinFindingPrompt,
  devinReviewErrorCopy,
  devinReviewFindingCountLabel,
  devinReviewStatusPresentation,
  isDevinReviewInvolvement,
  projectForDevinReview,
  writeDevinReviewInvolvement,
  type DevinReviewInvolvement,
} from "./devinReview.logic";

const INVOLVEMENT_OPTIONS = [
  { value: "all", label: msg("All", { $context: "pull request involvement filter" }) },
  { value: "authored", label: msg("Authored", { $context: "pull request involvement filter" }) },
  { value: "reviewing", label: msg("Reviewing", { $context: "pull request involvement filter" }) },
] as const satisfies ReadonlyArray<{ value: DevinReviewInvolvement; label: string }>;

/** Open pull requests with their Devin Review status and findings, for the primary environment. */
export function DevinReviewsPage() {
  const gt = useGT();
  const messages = useMessages();
  const search = useSearch({ from: "/_chat/devin-reviews" });
  const navigate = useNavigate({ from: "/devin-reviews" });
  const environmentId = usePrimaryEnvironmentId();
  const involvement = search.involvement;
  const list = useEnvironmentQuery(
    environmentId === null
      ? null
      : devinReviewEnvironment.reviews({ environmentId, input: { involvement } }),
  );
  const selected = list.data?.reviews.find((review) => review.reviewUrl === search.selected);

  const selectInvolvement = (next: DevinReviewInvolvement) => {
    writeDevinReviewInvolvement(next);
    void navigate({ search: (previous) => ({ ...previous, involvement: next }), replace: true });
  };
  const select = (reviewUrl: string | undefined) =>
    void navigate({ search: (previous) => ({ ...previous, selected: reviewUrl }) });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 flex-1">
        <section
          {...workspaceAreaProps("devin-reviews", 1, gt("Devin Reviews"))}
          className={cn(
            "flex min-h-0 min-w-0 flex-col bg-background",
            search.selected ? "hidden md:flex md:w-96 md:flex-none md:border-e" : "flex-1",
          )}
        >
          <WorkspacePageHeader electron={isElectron} reserveNativeControls={!search.selected}>
            <WorkspaceBreadcrumb ariaLabel={gt("Devin Reviews breadcrumb")}>
              <WorkspaceBreadcrumbItem>
                <button
                  type="button"
                  className="truncate hover:text-foreground"
                  onClick={() =>
                    void navigate({
                      to: "/pull-requests",
                      search: readPullRequestListPreferences(),
                    })
                  }
                >
                  <T>Pull requests</T>
                </button>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">
                  <T>Devin Reviews</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <div className="min-w-0 flex-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={gt("Refresh Devin reviews")}
              disabled={list.isPending || environmentId === null}
              onClick={list.refresh}
            >
              <RefreshIcon size="sm" refreshing={list.isPending} />
            </Button>
          </WorkspacePageHeader>
          <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
            <ToggleGroup
              aria-label={gt("Filter by involvement")}
              variant="segmented"
              value={[involvement]}
              onValueChange={(next) => {
                const value = next[0];
                if (isDevinReviewInvolvement(value)) selectInvolvement(value);
              }}
            >
              {INVOLVEMENT_OPTIONS.map((option) => (
                <Toggle key={option.value} value={option.value}>
                  {messages(option.label)}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
            <DevinReviewList
              environmentId={environmentId}
              reviews={list.data?.reviews ?? null}
              error={
                list.error === null
                  ? null
                  : devinReviewErrorCopy(list.failure, list.error, messages)
              }
              involvement={involvement}
              selectedUrl={search.selected}
              onSelect={select}
            />
          </div>
        </section>
        {search.selected && environmentId !== null ? (
          <DevinReviewDetail
            key={search.selected}
            environmentId={environmentId}
            reviewUrl={search.selected}
            summary={selected ?? null}
            onBack={() => select(undefined)}
            onTriggered={list.refresh}
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}

function DevinReviewList(props: {
  environmentId: EnvironmentId | null;
  reviews: ReadonlyArray<DevinReviewSummary> | null;
  error: string | null;
  involvement: DevinReviewInvolvement;
  selectedUrl: string | undefined;
  onSelect: (reviewUrl: string) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  if (props.environmentId === null) {
    return (
      <ListMessage
        title={gt("No environment")}
        description={gt("Connect to an environment first.")}
      />
    );
  }
  if (props.reviews === null) {
    if (props.error !== null) {
      return <ListMessage title={gt("Couldn't list reviews")} description={props.error} />;
    }
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        <T>Reading pull requests…</T>
      </p>
    );
  }
  if (props.reviews.length === 0) {
    return (
      <ListMessage
        title={gt("No open pull requests")}
        description={
          props.involvement === "authored"
            ? gt("You have no open pull requests.")
            : props.involvement === "reviewing"
              ? gt("Nobody has asked you to review an open pull request.")
              : gt("You have no open pull requests you authored or were asked to review.")
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-0.5" aria-label={gt("Pull requests")}>
      {props.reviews.map((review) => {
        const status = devinReviewStatusPresentation(review, messages);
        const selected = review.reviewUrl === props.selectedUrl;
        return (
          <li key={review.reviewUrl}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-start hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                selected && "bg-accent",
              )}
              onClick={() => props.onSelect(review.reviewUrl)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {review.repository}#{review.number}
                </span>
                <span className="min-w-0 flex-1" />
                <Badge size="sm" variant={status.variant}>
                  {status.label}
                </Badge>
              </span>
              <span className="truncate text-sm">{review.title}</span>
              <span
                className={cn(
                  "text-xs",
                  review.openFindingCount > 0 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {devinReviewFindingCountLabel(
                  review.openFindingCount,
                  review.findingCount,
                  messages,
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListMessage({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DevinReviewDetail(props: {
  environmentId: EnvironmentId;
  reviewUrl: string;
  /** The list's row, shown while the review loads. */
  summary: DevinReviewSummary | null;
  onBack: () => void;
  onTriggered: () => void;
}) {
  const { environmentId } = props;
  const gt = useGT();
  const openInThread = useOpenReviewThread(environmentId);
  const shown = props.summary;

  const attach = (context: DevinReviewContext) => {
    const record = devinReviewContextRecord(context);
    void openInThread(context.repository, ({ draftId, threadId }) => {
      useIssueContextStore.getState().upsert(threadId, record);
      useComposerDraftStore.getState().insertContextReference(draftId, {
        kind: record.kind,
        contextId: record.contextId,
        label: record.label,
      });
    });
  };

  const appendPrompt = (repository: string, prompt: string) => {
    void openInThread(repository, ({ draftId }) => {
      const store = useComposerDraftStore.getState();
      const existing = store.getComposerDraft(draftId)?.prompt.trimEnd() ?? "";
      store.setPrompt(draftId, existing.length > 0 ? `${existing}\n\n${prompt}` : prompt);
    });
  };
  const addFinding = (context: DevinReviewContext, finding: DevinReviewFinding) =>
    appendPrompt(context.repository, devinFindingPrompt(finding, context));
  const fixFinding = (context: DevinReviewContext, prompt: string) =>
    appendPrompt(context.repository, prompt);

  return (
    <section
      {...workspaceAreaProps("devin-review", 2, gt("Devin Review"))}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <WorkspacePageHeader electron={isElectron}>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Back to the list")}
          className="md:hidden"
          onClick={props.onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <WorkspaceBreadcrumb ariaLabel={gt("Devin Review breadcrumb")} className="min-w-0">
          <WorkspaceBreadcrumbItem current className="min-w-0">
            <h2 className="truncate">
              {shown ? `${shown.repository}#${shown.number}` : gt("Devin Review")}
            </h2>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <DevinReviewToolbar
          environmentId={environmentId}
          url={props.reviewUrl}
          summary={props.summary}
          showOpenPullRequest
          onTriggered={props.onTriggered}
          onAttach={attach}
        />
      </WorkspacePageHeader>
      <div
        data-pull-request-summary-scroll
        className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl pb-12">
          <DevinReviewContent
            environmentId={environmentId}
            url={props.reviewUrl}
            summary={props.summary}
            showTitle
            onAddFinding={addFinding}
            onFixFinding={fixFinding}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Opens a new thread in the project for the review's repository and writes into its composer, as
 * the pull request page does when no thread sits beside it.
 */
function useOpenReviewThread(environmentId: EnvironmentId) {
  const projects = useProjects();
  const newThread = useNewThreadHandler();
  return async (
    repository: string,
    write: (target: { readonly draftId: DraftId; readonly threadId: ThreadId }) => void,
  ) => {
    const project = projectForDevinReview(projects, repository, environmentId);
    if (project === null) {
      toastManager.add({
        type: "info",
        title: m(msg("No project for {repository}"), { repository }),
        description: m(msg("Add the repository as a project to send its review to an agent.")),
      });
      return;
    }
    const opened = await newThread(scopeProjectRef(project.environmentId, project.id)).then(
      (session) => session,
      () => null,
    );
    if (opened === null) {
      toastManager.add({ type: "error", title: m(msg("Could not open a thread")) });
      return;
    }
    write(opened);
  };
}
