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
  return (
    <AlertDialog open={stopChoiceOpen} onOpenChange={setStopChoiceOpen}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{presentStopChoice(runningWorkers).title}</AlertDialogTitle>
          <AlertDialogDescription>
            {presentStopChoice(runningWorkers).description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive-outline"
            disabled={!canOperateThread}
            onClick={() => {
              setStopChoiceOpen(false);
              void stopThread(false);
            }}
          >
            Stop everything
          </Button>
          <Button
            variant="default"
            disabled={!canOperateThread}
            onClick={() => {
              setStopChoiceOpen(false);
              void stopThread(true);
            }}
          >
            Stop turn only
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
