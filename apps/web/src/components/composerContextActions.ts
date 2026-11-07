import type {
  EnvironmentId,
  ProjectId,
  ModelContextRecord,
  UnreadLinkContextRecord,
} from "@t3tools/contracts";
import { createContext, type MouseEvent } from "react";

export interface ComposerContextActions {
  environmentId: EnvironmentId | null;
  cwd?: string | undefined;
  projectId?: ProjectId | undefined;
  expandImage: (imageId: string) => void;
  expandVideo: (fileId: string) => void;
  openFile: (fileId: string) => void;
  openMention: (path: string) => void;
  openLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  retryUnreadLink: (record: UnreadLinkContextRecord) => void;
  keepUnreadLinkAsText: (record: UnreadLinkContextRecord) => void;
  updateModelChip: (record: ModelContextRecord) => void;
  openPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
}

export const ComposerContextActionsContext = createContext<ComposerContextActions>({
  environmentId: null,
  expandImage: () => {},
  expandVideo: () => {},
  openFile: () => {},
  openMention: () => {},
  openPullRequest: () => {},
  openLink: () => {},
  retryUnreadLink: () => {},
  keepUnreadLinkAsText: () => {},
  updateModelChip: () => {},
});
