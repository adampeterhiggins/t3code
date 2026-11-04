import * as Schema from "effect/Schema";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import type { SidebarThreadSummary } from "../../types";
import type { SidebarThreadViews, ThreadGroups } from "@t3tools/contracts/settings";
import { repositoryGroupingKeyOf, type RepositoryIdentity } from "@t3tools/contracts";
import type { Organisation, Organisations } from "@t3tools/contracts/settings";
import { filterFacets } from "@t3tools/shared/filterFacets";

export type SidebarPage =
  | "threads"
  | `group:${string}`
  | "automations"
  | "snoozed"
  | "hidden"
  | "settled";

export const sidebarGroupPage = (groupName: string): SidebarPage => `group:${groupName}`;

/** Every page the Show filter offers, in list order: live work, groups by name, then shelves. */
export function availableSidebarPages(groupNames: readonly string[]): SidebarPage[] {
  return [
    "threads",
    ...groupNames.map(sidebarGroupPage),
    "automations",
    "snoozed",
    "hidden",
    "settled",
  ];
}

/**
 * Dragging places rows between pinned and active, so it needs every other listed section to
 * sit below them under a header the drop resolver knows. Automations does; groups and the
 * parked shelves are not modelled there.
 */
export function sidebarPagesAllowDragging(pages: readonly SidebarPage[]): boolean {
  return (
    pages.includes("threads") && pages.every((page) => page === "threads" || page === "automations")
  );
}

/**
 * The stored Show selection, kept to pages that still exist and put in list order. A group
 * whose last thread moved out drops away; an emptied selection falls back to live threads.
 * Exclusions that still name a page win over picks: every other page shows, new groups too.
 */
export function resolveSidebarPages(
  stored: readonly string[],
  groupNames: readonly string[],
  excluded: readonly string[] = [],
): SidebarPage[] {
  const available = availableSidebarPages(groupNames);
  const left = new Set(excluded);
  const picked = new Set(stored);
  const pages = available.some((page) => left.has(page))
    ? available.filter((page) => !left.has(page))
    : available.filter((page) => picked.has(page));
  return pages.length > 0 ? pages : ["threads"];
}

/**
 * The organisation a checkout's repository belongs to, keyed by host and owner so two hosts'
 * same-named owners stay apart. A fork counts under its own remote's owner. Null without a remote.
 */
export function repositoryOrganisationOf(
  identity: RepositoryIdentity | null | undefined,
): { readonly key: string; readonly label: string } | null {
  if (!identity) return null;
  const segments = repositoryGroupingKeyOf(identity).split("/");
  if (segments.length < 3) return null;
  const owner = segments.at(-2)!;
  return { key: segments.slice(0, -1).join("/"), label: owner };
}

/** Checkouts without a remote owner; real keys are `host/owner`, so this cannot collide. */
export const NO_ORGANISATION_KEY = "none";

/** The Organisations filter key of a checkout, with ownerless checkouts under NO_ORGANISATION_KEY. */
function repositoryOrganisationKeyOf(identity: RepositoryIdentity | null | undefined): string {
  return repositoryOrganisationOf(identity)?.key ?? NO_ORGANISATION_KEY;
}

export interface OrganisationOption {
  readonly key: string;
  /** The chosen name, else the owner (or host and owner when two hosts share it). */
  readonly label: string;
  /** What the label falls back to without a chosen name. */
  readonly defaultLabel: string;
  readonly organisation: Organisation | undefined;
}

/**
 * The organisations of these checkouts, with their chosen names and icons, sorted by label.
 * `picked` keys with no checkout left are offered too, by owner, so a filter on them stays
 * visible and can be dropped.
 */
export function buildOrganisationOptions(
  identities: Iterable<RepositoryIdentity | null | undefined>,
  organisations: Organisations,
  picked: readonly string[] = [],
): OrganisationOption[] {
  const byKey = new Map<string, { key: string; label: string }>();
  for (const identity of identities) {
    const organisation = repositoryOrganisationOf(identity);
    if (organisation) byKey.set(organisation.key, organisation);
  }
  for (const key of picked) {
    if (!byKey.has(key)) byKey.set(key, { key, label: key.split("/").at(-1) ?? key });
  }
  const options = [...byKey.values()];
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  }
  return options
    .map((option) => {
      const defaultLabel = (labelCounts.get(option.label) ?? 0) > 1 ? option.key : option.label;
      const organisation = organisations[option.key];
      return {
        key: option.key,
        label: organisation?.name ?? defaultLabel,
        defaultLabel,
        organisation,
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

/** A filter dimension's state: only its picks, or everything but its exclusions. */
export interface SidebarScope {
  readonly picked: readonly string[];
  readonly excluded: readonly string[];
}

const passesScope = (scope: SidebarScope, key: string | undefined) =>
  (scope.picked.length === 0 || (key !== undefined && scope.picked.includes(key))) &&
  (key === undefined || !scope.excluded.includes(key));

const scopeIsOff = (scope: SidebarScope) =>
  scope.picked.length === 0 && scope.excluded.length === 0;

/** The checkouts the Projects and Organisations filters let through, or null while both are off. */
export function sidebarScopedMemberKeys(input: {
  readonly projects: ReadonlyArray<{
    readonly projectKey: string;
    readonly memberProjects: ReadonlyArray<{
      readonly environmentId: string;
      readonly id: string;
      readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
    }>;
  }>;
  readonly projectScope: SidebarScope;
  readonly organisationScope: SidebarScope;
}): Set<string> | null {
  if (scopeIsOff(input.projectScope) && scopeIsOff(input.organisationScope)) return null;
  return new Set(
    input.projects
      .filter((project) => passesScope(input.projectScope, project.projectKey))
      .flatMap((project) =>
        project.memberProjects
          .filter((member) =>
            passesScope(
              input.organisationScope,
              repositoryOrganisationKeyOf(member.repositoryIdentity),
            ),
          )
          .map((member) => `${member.environmentId}:${member.id}`),
      ),
  );
}

/**
 * The sidebar filter's organisations: buildOrganisationOptions, then "No organisation" last when
 * a checkout has no remote owner or it is picked.
 */
export function buildSidebarOrganisationOptions(
  identities: ReadonlyArray<RepositoryIdentity | null | undefined>,
  organisations: Organisations,
  picked: readonly string[],
): OrganisationOption[] {
  const options = buildOrganisationOptions(
    identities,
    organisations,
    picked.filter((key) => key !== NO_ORGANISATION_KEY),
  );
  if (
    picked.includes(NO_ORGANISATION_KEY) ||
    identities.some((identity) => repositoryOrganisationOf(identity) === null)
  ) {
    options.push({
      key: NO_ORGANISATION_KEY,
      label: "No organisation",
      defaultLabel: "No organisation",
      organisation: undefined,
    });
  }
  return options;
}

/**
 * A thread as the sidebar filter menu counts it: where it lives and which Show pages hold it. A
 * thread in a group shown in Threads is on its shelf's page and its group's.
 */
export interface SidebarFacetThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly pages: readonly SidebarPage[];
}

/** Facet counts apply the other filters; excluded picks stay offered so they can be removed. */
export function buildSidebarFilterFacets<
  Project extends {
    readonly projectKey: string;
    readonly memberProjects: ReadonlyArray<{
      readonly environmentId: string;
      readonly id: string;
      readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
    }>;
  },
>(input: {
  readonly threads: readonly SidebarFacetThread[];
  readonly projects: readonly Project[];
  readonly pages: readonly SidebarPage[];
  readonly projectScope: SidebarScope;
  readonly organisationScope: SidebarScope;
}): {
  pageCounts: ReadonlyMap<SidebarPage, number>;
  projectCounts: ReadonlyMap<string, number>;
  organisationCounts: ReadonlyMap<string, number>;
  projects: Project[];
  organisationKeys: ReadonlySet<string>;
} {
  const projectKeyByMember = new Map<string, string>();
  const organisationByMember = new Map<string, string>();
  for (const project of input.projects) {
    for (const member of project.memberProjects) {
      const memberKey = `${member.environmentId}:${member.id}`;
      projectKeyByMember.set(memberKey, project.projectKey);
      organisationByMember.set(memberKey, repositoryOrganisationKeyOf(member.repositoryIdentity));
    }
  }
  const memberKey = (thread: SidebarFacetThread) => `${thread.environmentId}:${thread.projectId}`;
  const facets = filterFacets(input.threads, {
    page: { values: (thread) => thread.pages, selected: input.pages },
    project: {
      values: (thread) => {
        const key = projectKeyByMember.get(memberKey(thread));
        return key === undefined ? [] : [key];
      },
      selected: input.projectScope.picked,
      matches: (thread) =>
        passesScope(input.projectScope, projectKeyByMember.get(memberKey(thread))),
    },
    organisation: {
      values: (thread) => {
        const key = organisationByMember.get(memberKey(thread));
        return key === undefined ? [] : [key];
      },
      selected: input.organisationScope.picked,
      matches: (thread) =>
        passesScope(input.organisationScope, organisationByMember.get(memberKey(thread))),
    },
  });
  const counts = <Key extends string>(choices: ReadonlyArray<{ value: string; count: number }>) =>
    new Map(choices.map((choice) => [choice.value as Key, choice.count]));

  const pickedProjects = new Set(input.projectScope.picked);
  const memberOrganisations = (project: Project) =>
    project.memberProjects.map((member) => repositoryOrganisationKeyOf(member.repositoryIdentity));
  const projects = input.projects.filter(
    (project) =>
      pickedProjects.has(project.projectKey) ||
      input.projectScope.excluded.includes(project.projectKey) ||
      project.memberProjects.some((member) =>
        passesScope(
          input.organisationScope,
          repositoryOrganisationKeyOf(member.repositoryIdentity),
        ),
      ),
  );
  const organisationKeys = new Set([
    ...input.organisationScope.picked,
    ...input.organisationScope.excluded,
  ]);
  for (const project of input.projects) {
    if (pickedProjects.size > 0 && !pickedProjects.has(project.projectKey)) continue;
    for (const key of memberOrganisations(project)) organisationKeys.add(key);
  }
  return {
    pageCounts: counts<SidebarPage>(facets.page),
    projectCounts: counts(facets.project),
    organisationCounts: counts(facets.organisation),
    projects,
    organisationKeys,
  };
}

export function sidebarThreadView(
  section: keyof SidebarThreadViews,
  groupName: string | null | undefined,
  groups: ThreadGroups,
  views: SidebarThreadViews,
) {
  return section === "grouped" && groupName != null
    ? (groups[groupName]?.view ?? views.grouped)
    : views[section];
}

export const SidebarPagesSchema = Schema.Array(Schema.String);

export type SidebarInboxThread = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "latestRun"
  | "runtime"
> & {
  lastVisitedAt?: string | null | undefined;
  pendingBackgroundTasks?: SidebarThreadSummary["pendingBackgroundTasks"] | undefined;
  blockedOnThreadWait?: boolean | undefined;
};

/** Hidden and grouped threads keep their shelves; automations precede snooze, settlement and pins. */
export function resolveSidebarThreadSection(input: {
  readonly hidden?: boolean;
  readonly grouped?: boolean;
  readonly automation?: boolean;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly pinned: boolean;
}): SidebarThreadShelf {
  if (input.hidden) return "hidden";
  if (input.grouped) return "grouped";
  if (input.automation) return "automations";
  if (input.snoozed) return "snoozed";
  if (input.settled) return "settled";
  if (input.pinned) return "pinned";
  return "active";
}

export type SidebarThreadShelf =
  | "hidden"
  | "grouped"
  | "automations"
  | "snoozed"
  | "settled"
  | "pinned"
  | "working"
  | "active";

/**
 * The shelf a standalone sidebar row sits on. Pinned and active rows render as cards, whose tab
 * lists include the row's own thread; the other shelves show slim rows.
 */
export function sidebarThreadShelf(
  thread: SidebarInboxThread &
    ThreadSnoozeShell &
    Pick<
      SidebarThreadSummary,
      "settledOverride" | "pinnedAt" | "hiddenAt" | "groupName" | "scheduledTaskId"
    >,
  input: {
    supportsSnooze: boolean;
    supportsSettlement: boolean;
    workingShelfEnabled: boolean;
    working?: boolean;
    now: string;
    /** Groups whose threads keep their usual shelf instead of the group's. */
    groupsShownInThreads?: ReadonlySet<string>;
    /** Groups whose settled threads stay on Settled instead of the group's page. */
    groupsHidingSettled?: ReadonlySet<string>;
    /** Settled automation threads go to Settled instead of Automations. */
    automationsHidingSettled?: boolean;
  },
): SidebarThreadShelf {
  // Snooze outranks settlement and pinning until the thread wakes. Only servers
  // that understand hiding ever set hiddenAt, so it needs no capability check.
  const snoozed = input.supportsSnooze && effectiveSnoozed(thread, { now: input.now });
  const settled = input.supportsSettlement && thread.settledOverride === "settled";
  const automation = isSidebarAutomationThread(thread, {
    settled: settled && !snoozed,
    automationsHidingSettled: input.automationsHidingSettled,
  });
  const section = resolveSidebarThreadSection({
    hidden: thread.hiddenAt != null,
    grouped: isSidebarThreadGroupedAway(thread.groupName, input.groupsShownInThreads, {
      groupsHidingSettled: input.groupsHidingSettled,
      // Snooze and Automations keep a grouped thread; only a Settled-shelf thread leaves.
      settled: settled && !snoozed && !automation,
    }),
    automation,
    snoozed,
    settled,
    pinned: thread.pinnedAt != null,
  });
  if (section !== "active") return section;
  // Working beta: only inbox threads fold away.
  return input.workingShelfEnabled && (input.working ?? isThreadWorking(thread))
    ? "working"
    : "active";
}

/** Whether a scheduled task's thread lists on Automations rather than leaving for Settled. */
export function isSidebarAutomationThread(
  thread: Pick<SidebarThreadSummary, "scheduledTaskId">,
  options: {
    /** Settled and not snoozed, so it would list on Settled. */
    readonly settled: boolean;
    readonly automationsHidingSettled?: boolean | undefined;
  },
): boolean {
  return (
    thread.scheduledTaskId != null &&
    !(options.settled && options.automationsHidingSettled === true)
  );
}

/** Whether a thread's group takes it off the Threads, Snoozed and Settled pages. */
export function isSidebarThreadGroupedAway(
  groupName: string | null | undefined,
  groupsShownInThreads: ReadonlySet<string> | undefined,
  options?: {
    readonly groupsHidingSettled?: ReadonlySet<string> | undefined;
    /** The thread would sit on Settled if the group did not take it. */
    readonly settled?: boolean | undefined;
  },
): boolean {
  if (groupName == null) return false;
  if (options?.settled === true && options.groupsHidingSettled?.has(groupName) === true) {
    return false;
  }
  return groupsShownInThreads?.has(groupName) !== true;
}

/** The Show page a shelf belongs to: pinned, working and active rows are all live threads. */
export function sidebarShelfPage(
  shelf: SidebarThreadShelf,
  groupName: string | null | undefined,
): SidebarPage {
  if (shelf === "grouped") return sidebarGroupPage(groupName ?? "");
  if (shelf === "pinned" || shelf === "working" || shelf === "active") return "threads";
  return shelf;
}
