import { useEffect, useState } from "react";
import { create } from "zustand";
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

const useRequest = create<{
  request: { name: string | null; resolve: (name: string | null | undefined) => void } | null;
}>(() => ({ request: null }));

export function requestThreadTabGroupName(name: string | null) {
  useRequest.getState().request?.resolve(undefined);
  return new Promise<string | null | undefined>((resolve) =>
    useRequest.setState({ request: { name, resolve } }),
  );
}

function finish(name: string | null | undefined) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ThreadTabGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => finish(undefined), []);
  return request ? <NameDialog initial={request.name} /> : null;
}

function NameDialog({ initial }: { initial: string | null }) {
  const [name, setName] = useState(initial ?? "");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(undefined);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            finish(name.trim() || null);
          }}
        >
          <DialogHeader>
            <DialogTitle>Name thread group</DialogTitle>
            <DialogDescription>
              Leave blank to use the most recently opened tab’s title.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label htmlFor="tab-group-name">Group name</Label>
            <Input
              id="tab-group-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => finish(undefined)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
