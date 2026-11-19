import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { checkoutPathsEqual } from "@t3tools/shared/checkouts";
import { T, useGT } from "gt-react";
import { FolderIcon, PlusIcon, SquareArrowOutUpRightIcon, XIcon } from "lucide-react";

import { useOpenInPreferredEditor } from "~/editorPreferences";
import { useProjects, useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
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
  const gt = useGT();
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const shell = useThreadShell(threadRef);
  const links = shell?.source.linkedCheckouts ?? [];
  const projects = useProjects();
  const editors =
    useAtomValue(serverEnvironment.configValueAtom(props.environmentId))?.availableEditors ?? [];
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
      title={gt("Linked checkouts")}
      actions={
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Link a checkout")}
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
          const branch = entry?.branch ?? gt("detached HEAD");
          const detail =
            missing || entry === undefined
              ? link.path
              : entry.changedFiles > 0
                ? gt("{branch} · {count} changed", { branch, count: entry.changedFiles })
                : gt("{branch} · clean", { branch });
          return (
            <div key={link.path} className="group flex items-start gap-2 rounded-md px-1.5 py-1">
              <FolderIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{link.name}</div>
                <div className="truncate text-muted-foreground text-xs">{detail}</div>
                {missing ? (
                  <div className="truncate text-warning text-xs">
                    <T>Folder not found</T>
                  </div>
                ) : null}
              </div>
              {missing ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost-muted"
                    onClick={() => openCheckoutAttachPicker(threadRef, { relocateFrom: link.path })}
                  >
                    <T context="verb, find the moved folder">Locate</T>
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost-muted"
                    onClick={() =>
                      void unlink({
                        environmentId: props.environmentId,
                        input: { threadId: props.threadId, path: link.path },
                      })
                    }
                  >
                    <T context="verb">Unlink</T>
                  </Button>
                </div>
              ) : (
                <div className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Open {name}", { name: link.name })}
                    onClick={() => void openInEditor(link.path)}
                  >
                    <SquareArrowOutUpRightIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Unlink {name}", { name: link.name })}
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
