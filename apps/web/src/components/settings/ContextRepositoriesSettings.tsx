import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextRepositoryClone } from "@t3tools/contracts";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function cloneSummary(clone: ContextRepositoryClone) {
  const git = clone.git;
  const state =
    git === null
      ? null
      : [
          git.branch ?? "detached",
          git.ahead > 0 ? `${plural(git.ahead, "unpushed commit")}` : null,
          git.changedFiles > 0 ? `${plural(git.changedFiles, "changed file")}` : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  return [clone.remoteUrl ?? "No origin remote", state].filter((part) => part !== null).join(" — ");
}

/** What a removal throws away, so the confirmation can say so. */
function localWork(clone: ContextRepositoryClone) {
  const git = clone.git;
  if (git === null || (git.ahead === 0 && git.changedFiles === 0)) return null;
  return [
    git.changedFiles > 0 ? plural(git.changedFiles, "changed file") : null,
    git.ahead > 0 ? plural(git.ahead, "unpushed commit") : null,
  ]
    .filter((part) => part !== null)
    .join(" and ");
}

function ProjectContextRepositories({
  member,
  showLocation,
}: {
  member: SidebarProjectGroupMember;
  /** A project with several checkouts says which one each row belongs to. */
  showLocation: boolean;
}) {
  const { connectedEnvironments } = useSettingsScope();
  const environmentId = member.environmentId;
  const query = useEnvironmentQuery(
    sourceControlEnvironment.contextRepositoryClones({
      environmentId,
      input: { cwd: member.workspaceRoot },
    }),
  );
  const canWrite = useAtomValue(
    sourceControlEnvironment.removeContextRepository.permissionAtom(environmentId),
  );
  const supported =
    connectedEnvironments.find((environment) => environment.environmentId === environmentId)
      ?.serverConfig?.environment.capabilities.contextRepositoryRemoval === true;
  const remove = useAtomCommand(sourceControlEnvironment.removeContextRepository, {
    reportFailure: false,
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const directory = query.data?.directory ?? ".context";
  const location = showLocation
    ? `${member.workspaceRoot}${member.environmentLabel ? ` on ${member.environmentLabel}` : ""}`
    : null;

  const confirmRemove = async (clone: ContextRepositoryClone) => {
    const path = `${directory}/${clone.directoryName}`;
    const lost = localWork(clone);
    const confirmed = await requestConfirmDialog(
      `Remove ${path}?${lost === null ? "" : `\nIts ${lost} will be lost.`}`,
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    setRemoving(clone.directoryName);
    const result = await remove({
      environmentId,
      input: { cwd: member.workspaceRoot, directoryName: clone.directoryName },
    });
    setRemoving(null);
    query.refresh();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `Could not remove ${path}`,
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  if (query.error !== null) {
    return (
      <SettingsRow
        title={location ?? "Context repositories"}
        description={`Could not list context repositories: ${query.error}`}
      />
    );
  }
  if (query.data === null) return null;
  if (query.data.clones.length === 0) {
    return (
      <SettingsRow
        title={location ?? "No context repositories"}
        description={`No repositories are cloned into ${directory}/.`}
      />
    );
  }
  return query.data.clones.map((clone) => (
    <SettingsRow
      key={clone.directoryName}
      title={`${directory}/${clone.directoryName}`}
      description={location === null ? cloneSummary(clone) : `${location} — ${cloneSummary(clone)}`}
      control={
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          disabled={!supported || !canWrite || removing !== null}
          title={supported ? undefined : "Update this environment to remove context repositories."}
          onClick={() => void confirmRemove(clone)}
        >
          {removing === clone.directoryName ? "Removing…" : "Remove"}
        </Button>
      }
    />
  ));
}

/**
 * Repositories attached as context and cloned into each of the project's
 * checkouts, with a way to delete them. Worktree clones go with their worktree.
 */
export function ContextRepositoriesSection({
  members,
}: {
  members: readonly SidebarProjectGroupMember[];
}) {
  if (members.length === 0) return null;
  return (
    <SettingsSection id="storage-context-repositories" title="Context repositories">
      {members.map((member) => (
        <ProjectContextRepositories
          key={member.physicalProjectKey}
          member={member}
          showLocation={members.length > 1}
        />
      ))}
    </SettingsSection>
  );
}
