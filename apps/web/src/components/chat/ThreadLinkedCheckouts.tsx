import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { checkoutPathsEqual } from "@t3tools/shared/checkouts";
import { FolderIcon, PlusIcon, SquareArrowOutUpRightIcon, XIcon } from "lucide-react";

import { useOpenInPreferredEditor } from "~/editorPreferences";
import { useProjects, useThreadShell } from "~/state/entities";
import { primaryServerAvailableEditorsAtom } from "~/state/server";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomValue } from "@effect/atom-react";
import { Button } from "../ui/button";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { openCheckoutAttachPicker } from "./CheckoutAttachPicker";

/**
 * Checkouts linked to this thread. Each later turn includes them. Unlinking
 * leaves messages that already referenced one unchanged.
 */
export function ThreadLinkedCheckouts(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const shell = useThreadShell(threadRef);
  const links = shell?.source.linkedCheckouts ?? [];
  const projects = useProjects();
  const editors = useAtomValue(primaryServerAvailableEditorsAtom);
  const openInEditor = useOpenInPreferredEditor(props.environmentId, editors);
  const unlink = useAtomCommand(threadEnvironment.unlinkCheckout, { reportFailure: true });
  const paths = links.map((link) => link.path);
  const inspection = useEnvironmentQuery(
    paths.length === 0
      ? null
      : sourceControlEnvironment.checkouts({
          environmentId: props.environmentId,
          input: { paths },
        }),
  );
  if (
    links.length === 0 &&
    projects.every((project) => project.environmentId !== props.environmentId)
  ) {
    return null;
  }
  return (
    <ThreadDetailsSection
      headingId="thread-details-checkouts-heading"
      title="Linked checkouts"
      actions={
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Link a checkout"
          onClick={() => openCheckoutAttachPicker(threadRef)}
        >
          <PlusIcon />
        </Button>
      }
    >
      <div className="flex flex-col gap-0.5">
        {links.map((link) => {
          const entry = inspection.data?.entries.find((candidate) =>
            checkoutPathsEqual(candidate.path, link.path),
          );
          const missing = entry !== undefined && !entry.exists;
          const detail = missing
            ? link.path
            : entry === undefined
              ? link.path
              : `${entry.branch ?? "detached HEAD"}${entry.changedFiles > 0 ? ` · ${entry.changedFiles} changed` : " · clean"}`;
          return (
            <div key={link.path} className="group flex items-start gap-2 rounded-md px-1.5 py-1">
              <FolderIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{link.name}</div>
                <div className="truncate text-muted-foreground text-xs">{detail}</div>
                {missing ? (
                  <div className="mt-1 flex items-center gap-1 text-warning text-xs">
                    <span className="min-w-0 flex-1">Folder not found</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        openCheckoutAttachPicker(threadRef, { relocateFrom: link.path })
                      }
                    >
                      Locate
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void unlink({
                          environmentId: props.environmentId,
                          input: { threadId: props.threadId, path: link.path },
                        })
                      }
                    >
                      Unlink
                    </Button>
                  </div>
                ) : null}
              </div>
              {missing ? null : (
                <div className="flex opacity-0 group-hover:opacity-100">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Open ${link.name}`}
                    onClick={() => void openInEditor(link.path)}
                  >
                    <SquareArrowOutUpRightIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Unlink ${link.name}`}
                    onClick={() =>
                      void unlink({
                        environmentId: props.environmentId,
                        input: { threadId: props.threadId, path: link.path },
                      })
                    }
                  >
                    <XIcon />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}
