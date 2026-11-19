import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextRepositoryClone } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
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
import { m, type MessageResolver } from "../../i18n/messages";

function cloneSummary(clone: ContextRepositoryClone, resolve: MessageResolver) {
  const git = clone.git;
  const state =
    git === null
      ? null
      : [
          git.branch ?? resolve(msg("detached", { $context: "git HEAD not on a branch" })),
          git.ahead > 0
            ? resolve(
                msg(
                  "{count, plural, one {{count} unpushed commit} other {{count} unpushed commits}}",
                  { count: git.ahead },
                ),
              )
            : null,
          git.changedFiles > 0
            ? resolve(
                msg("{count, plural, one {{count} changed file} other {{count} changed files}}", {
                  count: git.changedFiles,
                }),
              )
            : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  return [clone.remoteUrl ?? resolve(msg("No origin remote")), state]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The confirmation names what a removal throws away. */
function removeConfirmation(path: string, clone: ContextRepositoryClone): string {
  const changed = clone.git?.changedFiles ?? 0;
  const ahead = clone.git?.ahead ?? 0;
  if (changed > 0 && ahead > 0) {
    return m(
      msg(
        "Remove {path}?\nIts {changed, plural, one {{changed} changed file} other {{changed} changed files}} and {ahead, plural, one {{ahead} unpushed commit} other {{ahead} unpushed commits}} will be lost.",
        { path, changed, ahead },
      ),
    );
  }
  if (changed > 0) {
    return m(
      msg(
        "Remove {path}?\nIts {changed, plural, one {{changed} changed file} other {{changed} changed files}} will be lost.",
        { path, changed },
      ),
    );
  }
  if (ahead > 0) {
    return m(
      msg(
        "Remove {path}?\nIts {ahead, plural, one {{ahead} unpushed commit} other {{ahead} unpushed commits}} will be lost.",
        { path, ahead },
      ),
    );
  }
  return m(msg("Remove {path}?", { path }));
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
  const gt = useGT();
  const messages = useMessages();
  const directory = query.data?.directory ?? ".context";
  const location = showLocation
    ? member.environmentLabel
      ? gt("{path} on {environment}", {
          path: member.workspaceRoot,
          environment: member.environmentLabel,
        })
      : member.workspaceRoot
    : null;

  const confirmRemove = async (clone: ContextRepositoryClone) => {
    const path = `${directory}/${clone.directoryName}`;
    const confirmed = await requestConfirmDialog(removeConfirmation(path, clone), {
      variant: "destructive",
    });
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
        title: m(msg("Could not remove {path}", { path })),
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  if (query.error !== null) {
    return (
      <SettingsRow
        title={location ?? gt("Context repositories")}
        description={gt("Could not list context repositories: {error}", {
          error: String(query.error),
        })}
      />
    );
  }
  if (query.data === null) return null;
  if (query.data.clones.length === 0) {
    return (
      <SettingsRow
        title={location ?? gt("No context repositories")}
        description={gt("No repositories are cloned into {directory}/.", { directory })}
      />
    );
  }
  return query.data.clones.map((clone) => (
    <SettingsRow
      key={clone.directoryName}
      title={`${directory}/${clone.directoryName}`}
      description={
        location === null
          ? cloneSummary(clone, messages)
          : `${location} · ${cloneSummary(clone, messages)}`
      }
      control={
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          disabled={!supported || !canWrite || removing !== null}
          title={
            supported ? undefined : gt("Update this environment to remove context repositories.")
          }
          onClick={() => void confirmRemove(clone)}
        >
          {removing === clone.directoryName
            ? gt("Removing…")
            : gt("Remove", { $context: "verb, deletes a cloned repository" })}
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
  const gt = useGT();
  if (members.length === 0) return null;
  return (
    <SettingsSection id="storage-context-repositories" title={gt("Context repositories")}>
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
