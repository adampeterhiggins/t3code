import type { ProjectIconColor } from "@t3tools/contracts";
import { SidebarThreadView, type ThreadGroup } from "@t3tools/contracts/settings";
import { msg, T, useGT, useMessages } from "gt-react";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { PROJECT_ICON_COLORS } from "../projectIconColors";
import { ThreadGroupIcon } from "./sidebar/ThreadGroupIcon";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

const ProjectIconPickerDialog = lazy(() =>
  import("./settings/ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

// "default" follows the Grouped threads setting in Settings. `msg()` labels: render with `useMessages()`.
export const THREAD_GROUP_VIEW_LABELS = {
  default: msg("Default"),
  card: msg("Detailed"),
  slim: msg("Compact"),
} as const;

export interface ThreadGroupDraft {
  readonly name: string;
  readonly group: ThreadGroup;
}

/** A saved draft, "delete" when the user deleted the group being edited, or null on cancel. */
export type ThreadGroupDialogResult = ThreadGroupDraft | "delete" | null;

type Request = {
  /** The group being edited; absent when naming a new one. */
  readonly initial: ThreadGroupDraft | null;
  readonly resolve: (result: ThreadGroupDialogResult) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks for a group's name, icon, accent, row style and listing; editing an existing group can also delete it. */
export function requestThreadGroup(
  initial: ThreadGroupDraft | null = null,
): Promise<ThreadGroupDialogResult> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { initial, resolve } }));
}

function finish(result: ThreadGroupDialogResult) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(result);
}

export function ThreadGroupDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears a pending group request when the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupDialog initial={request.initial} /> : null;
}

function ThreadGroupDialog(props: { initial: ThreadGroupDraft | null }) {
  const id = useId();
  const gt = useGT();
  const messages = useMessages();
  const editing = props.initial !== null;
  const [name, setName] = useState(props.initial?.name ?? "");
  const [style, setStyle] = useState<ThreadGroup>(props.initial?.group ?? {});
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const trimmed = name.trim();
  const setAccent = (accent: ProjectIconColor | undefined) => {
    const { accent: _accent, ...rest } = style;
    setStyle(accent === undefined ? rest : { ...rest, accent });
  };
  const clearIcon = () => {
    const { icon: _icon, ...rest } = style;
    setStyle(rest);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !iconPickerOpen) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) finish({ name: trimmed, group: style });
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? gt("Edit group") : gt("New group")}</DialogTitle>
            <DialogDescription>
              {editing
                ? gt("Renaming moves every thread in the group along with it.")
                : gt("Pick the group under Show in the sidebar filters to see it.")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>
                  <T>Name</T>
                </Label>
                <Input
                  id={`${id}-name`}
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder={gt("Research", { $context: "example thread group name" })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Icon</T>
                </Label>
                <div className="flex items-center gap-2">
                  <ThreadGroupIcon style={style} name={trimmed} className="size-6" />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setIconPickerOpen(true)}
                  >
                    <T>Choose…</T>
                  </Button>
                  {style.icon ? (
                    <Button type="button" size="sm" variant="ghost" onClick={clearIcon}>
                      <T>Remove</T>
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  <T>Accent</T>
                </Label>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    aria-label={gt("No accent")}
                    aria-pressed={style.accent === undefined}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      style.accent === undefined && "border-foreground/64",
                    )}
                    onClick={() => setAccent(undefined)}
                  >
                    <span className="size-4 rounded-full border border-dashed border-muted-foreground" />
                  </button>
                  {PROJECT_ICON_COLORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={messages(option.label)}
                      aria-pressed={style.accent === option.value}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        style.accent === option.value && "border-foreground/64",
                      )}
                      onClick={() => setAccent(option.value)}
                    >
                      <span className={cn("size-4 rounded-full", option.swatchClassName)} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${id}-view`}>
                  <T>Rows</T>
                </Label>
                <div className="w-36">
                  <Select
                    value={style.view ?? "default"}
                    onValueChange={(value) => {
                      const { view: _view, ...rest } = style;
                      setStyle(
                        value === "card" || value === "slim" ? { ...rest, view: value } : rest,
                      );
                    }}
                  >
                    <SelectTrigger id={`${id}-view`} size="sm">
                      <SelectValue>
                        {messages(THREAD_GROUP_VIEW_LABELS[style.view ?? "default"])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {(["default", ...SidebarThreadView.literals] as const).map((view) => (
                        <SelectItem key={view} value={view}>
                          {messages(THREAD_GROUP_VIEW_LABELS[view])}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <T>Also show its threads in Threads, Snoozed and Settled</T>
                </span>
                <Switch
                  checked={style.showInThreads === true}
                  onCheckedChange={(checked) => {
                    const { showInThreads: _showInThreads, ...rest } = style;
                    setStyle(checked ? { ...rest, showInThreads: true } : rest);
                  }}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <T>Show settled threads</T>
                </span>
                <Switch
                  checked={style.showSettled !== false}
                  onCheckedChange={(checked) => {
                    const { showSettled: _showSettled, ...rest } = style;
                    setStyle(checked ? rest : { ...rest, showSettled: false });
                  }}
                />
              </label>
            </div>
          </DialogPanel>
          <DialogFooter>
            {editing ? (
              // Deleting keeps every thread: they return to the live list.
              <div className="sm:mr-auto">
                <Button
                  type="button"
                  variant="destructive-outline"
                  onClick={() => finish("delete")}
                >
                  <T>Delete group</T>
                </Button>
              </div>
            ) : null}
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={trimmed.length === 0}>
              {editing ? gt("Save") : gt("Create group")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
      {iconPickerOpen ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            current={style.icon ?? null}
            projectName={trimmed || gt("Group", { $context: "fallback thread group name" })}
            open={iconPickerOpen}
            onOpenChange={setIconPickerOpen}
            onSelect={(icon) => {
              setStyle({ ...style, icon });
              setIconPickerOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </Dialog>
  );
}
