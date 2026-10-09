import type {
  ClientSettings,
  EnvironmentId,
  NotificationEvent,
  ProjectId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";

/** What a thread notification can be about; see `NotificationEvent`. */
export type ThreadNotificationEvent = NotificationEvent;

export type NotificationRules = Pick<
  ClientSettings,
  "mutedNotificationEvents" | "mutedNotificationProjects"
>;

/** The key `mutedNotificationProjects` stores. Project ids are environment-local. */
export function notificationProjectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

/**
 * The first event in `events` (most urgent first) the rules let through for a
 * thread in this project, or null when the project is muted or every event is.
 */
export function pickThreadNotification(
  events: ReadonlyArray<ThreadNotificationEvent>,
  rules: NotificationRules,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): ThreadNotificationEvent | null {
  if (
    rules.mutedNotificationProjects.includes(
      notificationProjectKey(project.environmentId, project.projectId),
    )
  ) {
    return null;
  }
  return events.find((event) => !rules.mutedNotificationEvents.includes(event)) ?? null;
}

/**
 * What the server's pull request watches have woken the agent about, as
 * stable tokens: failed checks on a head commit, a merge conflict, and
 * requested changes. A token missing from the previous read is news. A
 * conflict that clears and comes back is news again; the same check failing
 * again on the same commit is not.
 */
export function pullRequestWatchNews(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<string> {
  const tokens: string[] = [];
  for (const link of links) {
    const watch = link.watch;
    if (!watch) continue;
    const pr = `${link.host}/${link.repository}#${link.number}`;
    for (const check of watch.failedChecks) tokens.push(`${pr}:check:${watch.headSha}:${check}`);
    if (watch.conflicting) tokens.push(`${pr}:conflict`);
    if (watch.changesRequested === true) tokens.push(`${pr}:changes`);
  }
  return tokens;
}

export function hasNewPullRequestNews(
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): boolean {
  return next.some((token) => !previous.includes(token));
}
