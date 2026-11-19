import { T, useMessages } from "gt-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { presentStopChoice } from "@t3tools/client-runtime/state/thread-execution";

export function ChatViewStopDialog({
  stopChoiceOpen,
  setStopChoiceOpen,
  runningWorkers,
  canOperateThread,
  stopThread,
}: {
  stopChoiceOpen: boolean;
  setStopChoiceOpen: (open: boolean) => void;
  runningWorkers: Parameters<typeof presentStopChoice>[0];
  canOperateThread: boolean;
  stopThread: (keepBackgroundWork: boolean) => Promise<void>;
}) {
  const m = useMessages();
  const stopChoice = presentStopChoice(runningWorkers, m);
  return (
    <AlertDialog open={stopChoiceOpen} onOpenChange={setStopChoiceOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{stopChoice.title}</AlertDialogTitle>
          <AlertDialogDescription>{stopChoice.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button
            variant="destructive-outline"
            disabled={!canOperateThread}
            onClick={() => {
              setStopChoiceOpen(false);
              void stopThread(false);
            }}
          >
            <T>Stop everything</T>
          </Button>
          <Button
            variant="default"
            disabled={!canOperateThread}
            onClick={() => {
              setStopChoiceOpen(false);
              void stopThread(true);
            }}
          >
            <T>Stop turn only</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
