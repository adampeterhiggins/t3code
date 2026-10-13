import type { LinearFilterOptions, LinearIssueFilters } from "@t3tools/contracts";

type Team = LinearFilterOptions["teams"][number];
type Project = LinearFilterOptions["projects"][number];

export interface MilestoneGroup {
  readonly project: Project;
  readonly milestones: Project["milestones"];
}

/**
 * The team, project, and milestone choices the other applied filters leave possible. The options
 * cover the whole workspace and issues arrive server-filtered and capped, so this narrows only
 * where the options themselves say what can match: projects belong to teams, milestones to
 * projects. Assignees, statuses (deduped by name across teams), priorities, and labels are not
 * narrowed. A picked value the other filters rule out stays listed so it can be unpicked.
 */
export function narrowLinearFilterOptions(
  options: LinearFilterOptions,
  filters: LinearIssueFilters,
): {
  teams: Team[];
  projects: Project[];
  milestoneGroups: MilestoneGroup[];
} {
  const pickedTeams = new Set(filters.teamIds);
  const inPickedTeams = (project: Project) =>
    pickedTeams.size === 0 || project.teamIds.some((id) => pickedTeams.has(id));
  // "No project" admits issues from any team, so it leaves the team menu whole.
  const pickedProjects = options.projects.filter((project) =>
    filters.projectIds.includes(project.id),
  );
  const projectTeams =
    filters.projectIds.length === 0 || filters.projectIds.includes("none")
      ? null
      : new Set(pickedProjects.flatMap((project) => project.teamIds));

  const teams = options.teams.filter(
    (team) => projectTeams === null || projectTeams.has(team.id) || pickedTeams.has(team.id),
  );
  const projects = options.projects.filter(
    (project) => inPickedTeams(project) || filters.projectIds.includes(project.id),
  );
  // Milestones of the picked projects, or of every project the teams allow when none is picked.
  const milestoneProjects =
    pickedProjects.length > 0 ? pickedProjects : projects.filter(inPickedTeams);
  const milestoneGroups = options.projects.flatMap((project): MilestoneGroup[] => {
    const milestones = milestoneProjects.includes(project)
      ? project.milestones
      : project.milestones.filter((milestone) => filters.milestoneIds.includes(milestone.id));
    return milestones.length > 0 ? [{ project, milestones }] : [];
  });
  return { teams, projects, milestoneGroups };
}
