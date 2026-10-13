import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { checkoutPathsEqual, sameCheckoutRepository } from "@t3tools/shared/checkouts";
import { Atom } from "effect/reactivity";
import { FolderIcon, GitBranchIcon, LaptopIcon, ServerIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs, useThreadShell } from "~/state/entities";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { Button } from "../ui/button";
import {
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";

import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useAttachCheckout, useComposerCheckoutItems } from "./useComposerCheckoutItems";

type CheckoutPickerRequest = {
  readonly threadRef: ScopedThreadRef;
  readonly relocateFrom: string | null;
};

const checkoutAttachPickerAtom = Atom.make<CheckoutPickerRequest | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:checkout-attach-picker"),
);

export function openCheckoutAttachPicker(
  threadRef: ScopedThreadRef,
  options?: { readonly relocateFrom?: string },
): void {
  appAtomRegistry.set(checkoutAttachPickerAtom, {
    threadRef,
    relocateFrom: options?.relocateFrom ?? null,
  });
}

export function CheckoutAttachPickerHost() {
  const request = useAtomValue(checkoutAttachPickerAtom);
  if (request === null) return null;
  return (
    <CheckoutAttachPickerDialog
      request={request}
      onClose={() => appAtomRegistry.set(checkoutAttachPickerAtom, null)}
    />
  );
}

function CheckoutAttachPickerDialog(props: {
  request: CheckoutPickerRequest;
  onClose: () => void;
}) {
  const { threadRef, relocateFrom } = props.request;
  const [query, setQuery] = useState("");
  const [dirtyOnly, setDirtyOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [linkToThread, setLinkToThread] = useState(true);
  const [locateError, setLocateError] = useState<string | null>(null);
  const shell = useThreadShell(threadRef);
  const configs = useServerConfigs();
  const driver =
    configs
      .get(threadRef.environmentId)
      ?.providers.find((provider) => provider.instanceId === shell?.modelSelection.instanceId)
      ?.driver ?? null;
  const choices = useComposerCheckoutItems(threadRef.environmentId, {
    enabled: true,
    query,
  });
  const attach = useAttachCheckout(driver);
  const relocate = useAtomCommand(threadEnvironment.relocateCheckout, { reportFailure: true });
  const comparison = useEnvironmentQuery(
    relocateFrom === null
      ? null
      : sourceControlEnvironment.checkouts({
          environmentId: threadRef.environmentId,
          input: { paths: [relocateFrom] },
        }),
  );
  const rows = useMemo(() => {
    const items = choices.items.flatMap((item) => (item.type === "checkout" ? [item] : []));
    const filtered = dirtyOnly
      ? items.filter((item) => item.changedFiles !== null && item.changedFiles > 0)
      : items;
    if (sort === "name") {
      return filtered.toSorted((left, right) => left.label.localeCompare(right.label));
    }
    return filtered;
  }, [choices.items, dirtyOnly, sort]);

  const select = (item: Extract<ComposerReferenceItem, { type: "checkout" }>) => {
    if (!item.selectable) return;
    if (relocateFrom === null) {
      attach(threadRef, item, { link: linkToThread });
      props.onClose();
      return;
    }
    const from = comparison.data?.entries[0];
    const target = choices.entries.find((entry) => checkoutPathsEqual(entry.path, item.path));
    if (!sameCheckoutRepository(from, target)) {
      setLocateError("That folder is not the same repository.");
      return;
    }
    void relocate({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        fromPath: relocateFrom,
        path: item.path,
        name: item.label,
      },
    }).then((result) => {
      if (result._tag === "Success") props.onClose();
    });
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <CommandDialogPopup aria-label="Attach checkout" className="overflow-hidden">
        <CommandPaletteContent
          inputProps={{
            placeholder: "Search checkouts by name, branch, or path",
            startAddon: <LaptopIcon />,
          }}
          footerActionLabel="Attach"
          footerTrailing={
            relocateFrom === null ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={linkToThread}
                onClick={() => setLinkToThread((value) => !value)}
              >
                <span
                  className={cn(
                    "size-3.5 rounded-[4px] border",
                    linkToThread
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input",
                  )}
                  aria-hidden
                />
                Also link to thread
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">
                {locateError ?? "Choose the folder this checkout moved to."}
              </span>
            )
          }
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <Button
              type="button"
              size="xs"
              variant={dirtyOnly ? "secondary" : "ghost"}
              aria-pressed={dirtyOnly}
              onClick={() => setDirtyOnly((value) => !value)}
            >
              {dirtyOnly ? "Dirty only" : "Filter"}
            </Button>
            <div className="flex-1" />
            <Menu>
              <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
                {sort === "recent" ? "Recently used" : "Name"}
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value === "name" ? "name" : "recent")}
                >
                  <MenuRadioItem value="recent">Recently used</MenuRadioItem>
                  <MenuRadioItem value="name">Name</MenuRadioItem>
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          </div>
          {rows.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              {choices.isPending
                ? "Looking up checkouts…"
                : (choices.error ??
                  "No checkouts match. Paste a path to use a folder T3 does not already know.")}
            </div>
          ) : (
            <CommandList>
              <CommandGroup items={rows}>
                <CommandCollection>
                  {(item: Extract<ComposerReferenceItem, { type: "checkout" }>) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      disabled={!item.selectable}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(item)}
                    >
                      <CheckoutPickerRow item={item} />
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            </CommandList>
          )}
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function CheckoutPickerRow(props: { item: Extract<ComposerReferenceItem, { type: "checkout" }> }) {
  const status =
    props.item.changedFiles === null
      ? ""
      : props.item.changedFiles === 0
        ? "clean"
        : `${props.item.changedFiles} changed`;
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2",
        props.item.selectable ? "" : "opacity-45",
      )}
    >
      {props.item.selectable ? (
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="w-28 shrink-0 truncate text-sm">{props.item.label}</span>
      <span className="hidden w-32 shrink-0 items-center gap-1 truncate text-muted-foreground text-xs sm:flex">
        <GitBranchIcon className="size-3 shrink-0" />
        <span className="truncate font-mono">
          {props.item.branch ?? (props.item.headSha ? props.item.headSha.slice(0, 7) : "unknown")}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/70 text-xs">
        {props.item.path}
      </span>
      <span
        className={cn(
          "w-20 shrink-0 truncate text-end text-muted-foreground/70 text-xs",
          props.item.changedFiles !== null && props.item.changedFiles > 0 && "text-warning",
        )}
      >
        {status}
      </span>
    </span>
  );
}
