import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  DevinReviewContext,
  DevinReviewFinding,
  DevinReviewProgressStream,
  DevinReviewRun,
  DevinReviewSummary,
  DevinReviewWalkthroughSection,
  EnvironmentId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  ActivityIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  PlayIcon,
  WrenchIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { devinReviewEnvironment } from "~/state/devinReview";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { DevinIcon } from "../Icons";
import { RelativeTime } from "../RelativeTime";
import {
  PullRequestMetaRow as MetaRow,
  PullRequestSection as Section,
} from "../pullRequest/PullRequestSummaryTab";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DEVIN_SEVERITY_LABELS,
  DEVIN_SEVERITY_VARIANTS,
  devinFindingFixPrompt,
  devinFindingLocation,
  devinFindingStateLabel,
  devinProgressStepLabel,
  devinProgressStreamLabel,
  devinReviewErrorCopy,
  devinReviewFindingCountLabel,
  devinReviewRunLabel,
  devinReviewStatusPresentation,
  isDevinReviewInFlight,
  partitionDevinFindings,
} from "./devinReview.logic";

// Devin has no push API; its own review page polls about this often while a review runs.
const IN_FLIGHT_POLL_MS = 15_000;
// Slower otherwise, so a review started elsewhere (GitHub, another device, an agent) appears.
const IDLE_POLL_MS = 60_000;

function useDevinReview(environmentId: EnvironmentId, url: string) {
  return useEnvironmentQuery(devinReviewEnvironment.review({ environmentId, input: { url } }));
}

/** Devin's own answer for the review's status, which can be newer than the findings' read. */
function useDevinReviewStatus(environmentId: EnvironmentId, url: string) {
  return useEnvironmentQuery(devinReviewEnvironment.status({ environmentId, input: { url } }));
}

function IconAction(props: {
  label: string;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  render?: ReactElement;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            {...(props.render ? { render: props.render } : {})}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Devin's status and the review's actions as one compact row, for the pull request panel's tab
 * bar or the Devin Reviews page header.
 */
export function DevinReviewToolbar(props: {
  environmentId: EnvironmentId;
  /** The Devin Review link or the pull request's own link. */
  url: string;
  summary?: DevinReviewSummary | null;
  /** Shows Open pull request, where the pull request is not already on screen. */
  showOpenPullRequest?: boolean;
  onTriggered?: () => void;
  onAttach?: ((context: DevinReviewContext) => void) | undefined;
}) {
  const { environmentId } = props;
  const gt = useGT();
  const messages = useMessages();
  const openLink = useLinkClickHandler(null);
  const review = useDevinReview(environmentId, props.url);
  const connection = useEnvironmentQuery(
    devinReviewEnvironment.connection({ environmentId, input: {} }),
  ).data;
  const trigger = useAtomCommand(devinReviewEnvironment.trigger, { reportFailure: false });
  const canTrigger = useAtomValue(devinReviewEnvironment.trigger.permissionAtom(environmentId));
  const [triggering, setTriggering] = useState(false);
  const data = review.data;
  const shown = data ?? props.summary ?? null;
  const onAttach = props.onAttach;
  const devinStatus = useDevinReviewStatus(environmentId, props.url);

  const runReview = async () => {
    if (triggering) return;
    setTriggering(true);
    const result = await trigger({ environmentId, input: { url: props.url } });
    setTriggering(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: gt("Couldn't start the review"),
          description: devinReviewErrorCopy(
            failure,
            failure instanceof Error ? failure.message : null,
            messages,
          ),
        });
      }
      return;
    }
    devinStatus.refresh();
    toastManager.add({ type: "success", title: gt("Devin is reviewing the pull request") });
    review.refresh();
    props.onTriggered?.();
  };

  const reviewUrl = shown?.reviewUrl ?? null;
  const pullRequestUrl = props.showOpenPullRequest ? (shown?.pullRequestUrl ?? null) : null;
  const currentStatus = devinStatus.data?.status ?? shown?.status ?? null;
  const inFlight = currentStatus !== null && isDevinReviewInFlight(currentStatus);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      {connection?.phase === "connected" && canTrigger ? (
        <IconAction
          label={
            inFlight
              ? gt("Devin is reviewing")
              : triggering
                ? gt("Starting review…")
                : gt("Run review")
          }
          disabled={triggering || inFlight}
          onClick={() => void runReview()}
        >
          <PlayIcon />
        </IconAction>
      ) : null}
      {onAttach ? (
        <IconAction
          label={gt("Attach review to message")}
          disabled={data === null}
          onClick={() => {
            if (data !== null) onAttach(data);
          }}
        >
          <PaperclipIcon />
        </IconAction>
      ) : null}
      {reviewUrl ? (
        <IconAction
          label={gt("Open in {product}", { product: "Devin" })}
          render={<a href={reviewUrl} target="_blank" rel="noreferrer" />}
          onClick={(event) => openLink(event, reviewUrl)}
        >
          <DevinIcon />
        </IconAction>
      ) : null}
      {pullRequestUrl ? (
        <IconAction
          label={gt("Open pull request")}
          render={<a href={pullRequestUrl} target="_blank" rel="noreferrer" />}
          onClick={(event) => openLink(event, pullRequestUrl)}
        >
          <ExternalLinkIcon />
        </IconAction>
      ) : null}
      <IconAction label={gt("Refresh review")} disabled={review.isPending} onClick={review.refresh}>
        <RefreshIcon size="sm" refreshing={review.isPending} />
      </IconAction>
    </div>
  );
}

/**
 * One pull request's Devin Review laid out like the pull request summary: status rows, then
 * collapsible Walkthrough, Findings, and Review runs sections. Its scroll container should carry
 * `data-pull-request-summary-scroll`, as the summary's does, so collapsing keeps headings put.
 */
export function DevinReviewContent(props: {
  environmentId: EnvironmentId;
  url: string;
  summary?: DevinReviewSummary | null;
  /** Shows the pull request's title, where the pull request is not already on screen. */
  showTitle?: boolean;
  onAddFinding?: ((context: DevinReviewContext, finding: DevinReviewFinding) => void) | undefined;
  addFindingLabel?: string;
  /** Hands Devin's suggested fix, already built into a prompt, to an agent. */
  onFixFinding?: ((context: DevinReviewContext, prompt: string) => void) | undefined;
  /** False while the view stays mounted but hidden, such as behind another panel tab. */
  active?: boolean;
}) {
  const { environmentId } = props;
  const active = props.active ?? true;
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const openLink = useLinkClickHandler(null);
  const review = useDevinReview(environmentId, props.url);
  const connection = useEnvironmentQuery(
    devinReviewEnvironment.connection({ environmentId, input: {} }),
  ).data;
  const data = review.data;
  const fetched = data ?? props.summary ?? null;
  const devinStatus = useDevinReviewStatus(environmentId, props.url);
  const snapshot = devinStatus.data;
  const shown =
    fetched === null || snapshot == null || snapshot.status === "unknown"
      ? fetched
      : { ...fetched, status: snapshot.status, statusAt: snapshot.statusAt };
  const status = shown ? devinReviewStatusPresentation(shown, messages) : null;
  const inFlight = shown !== null && isDevinReviewInFlight(shown.status);
  const pollStatus = devinStatus.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls Devin, which has no push API, only while the review is on screen
  useEffect(() => {
    if (!active) return;
    const poll = () => {
      if (document.visibilityState === "visible") pollStatus();
    };
    // Coming back into view reads Devin at once rather than after a whole interval.
    poll();
    const timer = setInterval(poll, inFlight ? IN_FLIGHT_POLL_MS : IDLE_POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [active, inFlight, pollStatus]);
  // A new status from Devin (a review started or finished) means new findings may be on GitHub.
  const snapshotKey = snapshot ? `${snapshot.status}:${snapshot.statusAt ?? ""}` : null;
  const refreshReview = review.refresh;
  const lastSnapshotKey = useRef(snapshotKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads findings from GitHub when Devin's status changes
  useEffect(() => {
    const previous = lastSnapshotKey.current;
    lastSnapshotKey.current = snapshotKey;
    if (previous !== null && snapshotKey !== null && previous !== snapshotKey) refreshReview();
  }, [snapshotKey, refreshReview]);
  const latestRun = data?.runs?.[0] ?? null;
  const onAddFinding = props.onAddFinding;
  const onFixFinding = props.onFixFinding;

  return (
    <div className="flex min-w-0 flex-col">
      <section aria-label={gt("Devin Review status")} className="px-4 pt-2.5 pb-1">
        {props.showTitle && shown ? (
          <p className="pb-2 text-sm font-medium text-foreground">{shown.title}</p>
        ) : null}
        <MetaRow icon={<ActivityIcon className="size-3.5" />} label={gt("Status")}>
          {status ? (
            <Badge size="sm" variant={status.variant}>
              {status.label}
            </Badge>
          ) : (
            <span className="text-muted-foreground">
              <T>Reading…</T>
            </span>
          )}
        </MetaRow>
        <MetaRow icon={<CircleDotIcon className="size-3.5" />} label={gt("Findings")}>
          {shown
            ? devinReviewFindingCountLabel(shown.openFindingCount, shown.findingCount, messages)
            : "…"}
        </MetaRow>
        {latestRun ? (
          <MetaRow icon={<HistoryIcon className="size-3.5" />} label={gt("Last run")}>
            <span className="text-muted-foreground">
              {devinReviewRunLabel(latestRun, messages)} ·{" "}
              <RelativeTime timestamp={latestRun.createdAt} />
            </span>
          </MetaRow>
        ) : null}
        {connection != null && connection.phase !== "connected" ? (
          <p className="pt-1.5 text-xs text-muted-foreground">
            <T>
              Findings are read from GitHub.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => void navigate({ to: "/settings/integrations" })}
              >
                Sign in to Devin
              </button>{" "}
              for review status, the walkthrough, and suggested fixes.
            </T>
          </p>
        ) : null}
      </section>
      {inFlight && active ? (
        <DevinReviewProgress environmentId={environmentId} url={props.url} onEnded={pollStatus} />
      ) : null}
      {data === null ? (
        <p
          className={
            review.error !== null
              ? "px-4 py-3 text-xs text-destructive"
              : "px-4 py-3 text-xs text-muted-foreground"
          }
        >
          {review.error !== null
            ? devinReviewErrorCopy(review.failure, review.error, messages)
            : gt("Reading findings…")}
        </p>
      ) : (
        <DevinReviewSections
          context={data}
          onOpenLink={openLink}
          addLabel={props.addFindingLabel ?? gt("Add to composer")}
          {...(onAddFinding ? { onAddFinding: (finding) => onAddFinding(data, finding) } : {})}
          {...(onFixFinding ? { onFix: (prompt) => onFixFinding(data, prompt) } : {})}
        />
      )}
    </div>
  );
}

/**
 * What Devin's reviewer is doing, one line per tool call, pushed by the server every couple of
 * seconds while the review runs. Pinned to the newest line, as Devin's own page is.
 */
function DevinReviewProgress(props: {
  environmentId: EnvironmentId;
  url: string;
  /** Called once Devin reports the review ended, so the status reads it without waiting. */
  onEnded: () => void;
}) {
  const gt = useGT();
  const progress = useEnvironmentQuery(
    devinReviewEnvironment.progress({
      environmentId: props.environmentId,
      input: { url: props.url },
    }),
  ).data;
  const ended =
    progress != null && progress.status !== "not_started" && progress.status !== "running";
  const onEnded = props.onEnded;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads Devin's status as soon as the review on screen ends
  useEffect(() => {
    if (ended) onEnded();
  }, [ended, onEnded]);
  if (progress == null) return null;
  const parallel = progress.streams.length > 1 || progress.streams[0]?.kind !== "review";
  return (
    <Section title={gt("Progress", { $context: "Devin review progress" })}>
      {progress.status === "not_started" ? (
        <p className="text-xs text-muted-foreground">
          <T>Waiting for Devin to start the review…</T>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {progress.streams.map((stream) => (
            <DevinReviewProgressStreamView key={stream.kind} stream={stream} showTitle={parallel} />
          ))}
        </div>
      )}
    </Section>
  );
}

function DevinReviewProgressStreamView(props: {
  stream: DevinReviewProgressStream;
  showTitle: boolean;
}) {
  const { stream } = props;
  const gt = useGT();
  const messages = useMessages();
  const running = stream.status === "running";
  const label = devinProgressStreamLabel(stream, messages);
  // Steps only append, so a step's number in the whole run identifies it.
  const steps = stream.steps.map((step, index) => ({ step, number: stream.omittedSteps + index }));
  const lastNumber = stream.omittedSteps + stream.steps.length - 1;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {props.showTitle ? (
        <p className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">{label.title}</span>
          <span
            className={
              stream.status === "errored"
                ? "ml-auto text-destructive"
                : "ml-auto text-muted-foreground"
            }
          >
            {label.status}
          </span>
        </p>
      ) : null}
      {/* column-reverse keeps the scroll pinned to the newest line without script. */}
      <div className="flex max-h-40 flex-col-reverse overflow-y-auto">
        <ol className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {stream.omittedSteps > 0 ? (
            <li>
              {gt("{count, plural, one {{count} earlier step} other {{count} earlier steps}}", {
                count: stream.omittedSteps,
              })}
            </li>
          ) : null}
          {stream.steps.length === 0 && running ? (
            <li>
              <T>Starting the reviewer…</T>
            </li>
          ) : null}
          {steps.map(({ step, number }) => (
            <li
              key={number}
              className={
                running && number === lastNumber && !stream.awaitingModel
                  ? "truncate text-foreground"
                  : "truncate"
              }
            >
              {devinProgressStepLabel(step, messages)}
            </li>
          ))}
          {running && stream.awaitingModel ? (
            <li className="text-foreground">
              <T>Thinking…</T>
            </li>
          ) : null}
        </ol>
      </div>
    </div>
  );
}

function DevinReviewSections(props: {
  context: DevinReviewContext;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  addLabel: string;
  onAddFinding?: (finding: DevinReviewFinding) => void;
  onFix?: (prompt: string) => void;
}) {
  const { context } = props;
  const gt = useGT();
  const { open, closed } = partitionDevinFindings(context.findings);
  const fix = props.onFix;
  const card = (finding: DevinReviewFinding) => (
    <DevinFindingCard
      key={finding.id}
      finding={finding}
      onOpenLink={props.onOpenLink}
      addLabel={props.addLabel}
      {...(props.onAddFinding ? { onAdd: props.onAddFinding } : {})}
      {...(fix ? { fixPrompt: devinFindingFixPrompt(finding, context), onFix: fix } : {})}
    />
  );
  const walkthrough = context.walkthrough ?? [];
  const runs = context.runs ?? [];
  return (
    <>
      {walkthrough.length > 0 ? (
        <Section title={gt("Walkthrough")}>
          <DevinReviewWalkthrough sections={walkthrough} />
        </Section>
      ) : null}
      <Section
        title={
          open.length > 0 ? gt("Findings · {count} open", { count: open.length }) : gt("Findings")
        }
      >
        {open.length > 0 ? (
          <div className="flex flex-col gap-2">{open.map(card)}</div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {closed.length > 0
              ? gt("No open findings.")
              : gt("Devin left no findings on this change.")}
          </p>
        )}
      </Section>
      {closed.length > 0 ? (
        <Section title={gt("Closed · {count}", { count: closed.length })} defaultOpen={false}>
          <div className="flex flex-col gap-2">{closed.map(card)}</div>
        </Section>
      ) : null}
      {runs.length > 0 ? (
        <Section title={gt("Review runs · {count}", { count: runs.length })} defaultOpen={false}>
          <DevinReviewRuns runs={runs} />
        </Section>
      ) : null}
    </>
  );
}

/** Devin's walkthrough: the Overview, then its numbered sections folded under it. */
function DevinReviewWalkthrough(props: { sections: ReadonlyArray<DevinReviewWalkthroughSection> }) {
  const [overview, ...rest] = props.sections;
  if (overview === undefined) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm">
        <ChatMarkdown text={overview.text} cwd={undefined} />
      </div>
      {rest.length > 0 ? (
        <div className="mt-1 divide-y divide-border/60 rounded-lg border border-border/60">
          {rest.map((section) => (
            // Devin numbers its own section titles.
            <Collapsible key={section.title}>
              <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-foreground hover:bg-muted/40">
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-data-panel-open:rotate-90"
                />
                <span className="min-w-0 truncate">{section.title}</span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="px-3 pt-0.5 pb-3 pl-8 text-sm">
                  <ChatMarkdown text={section.text} cwd={undefined} />
                </div>
              </CollapsiblePanel>
            </Collapsible>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Each time Devin reviewed the pull request, newest first. */
function DevinReviewRuns(props: { runs: ReadonlyArray<DevinReviewRun> }) {
  const messages = useMessages();
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-xs">
      {props.runs.map((run) => (
        <li key={run.id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-foreground">
            {devinReviewRunLabel(run, messages)}
          </span>
          <time dateTime={run.createdAt} className="shrink-0 text-muted-foreground">
            <RelativeTime timestamp={run.createdAt} />
          </time>
        </li>
      ))}
    </ul>
  );
}

function DevinFindingCard(props: {
  finding: DevinReviewFinding;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  addLabel: string;
  onAdd?: (finding: DevinReviewFinding) => void;
  fixPrompt?: string | null;
  onFix?: (prompt: string) => void;
}) {
  const { finding, onAdd, onFix, fixPrompt } = props;
  const messages = useMessages();
  const location = devinFindingLocation(finding);
  const stateLabel = devinFindingStateLabel(finding, messages);
  const reason = finding.resolutionReason?.trim();
  return (
    <article className="rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:160px] [content-visibility:auto]">
      <header className="flex min-w-0 items-center gap-2 rounded-t-lg bg-muted/25 px-3 py-2">
        <Badge size="sm" variant={DEVIN_SEVERITY_VARIANTS[finding.severity]}>
          {messages(DEVIN_SEVERITY_LABELS[finding.severity])}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {finding.title}
        </span>
        {stateLabel ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{stateLabel}</span>
        ) : null}
      </header>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {location ? (
          <a
            href={finding.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={(event) => props.onOpenLink(event, finding.url)}
          >
            {location}
          </a>
        ) : null}
        {finding.impactSummary ? (
          <p className="text-xs text-foreground">{finding.impactSummary}</p>
        ) : null}
        <div className="text-sm text-muted-foreground">
          <ChatMarkdown text={finding.body} cwd={undefined} />
        </div>
        {reason && finding.devinState != null && finding.devinState !== "open" ? (
          <p className="text-2xs text-muted-foreground">
            <T>
              Devin: <Var>{reason}</Var>
            </T>
          </p>
        ) : null}
      </div>
      {onAdd || (onFix && fixPrompt) ? (
        <footer className="flex flex-wrap justify-end gap-1 border-t border-border/60 px-2 py-1">
          {onFix && fixPrompt ? (
            <Button size="xs" variant="ghost" onClick={() => onFix(fixPrompt)}>
              <WrenchIcon />
              <T>Fix with agent</T>
            </Button>
          ) : null}
          {onAdd ? (
            <Button size="xs" variant="ghost" onClick={() => onAdd(finding)}>
              <MessageSquarePlusIcon />
              {props.addLabel}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
