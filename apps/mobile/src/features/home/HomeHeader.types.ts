import type { EnvironmentId } from "@t3tools/contracts";
import type { ThreadGroups } from "@t3tools/contracts/settings";
import type { ThreadListPage } from "../threads/threadListV2";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export interface HomeHeaderProps {
  readonly environments: ReadonlyArray<HomeHeaderEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  /** Filter-menu pages (multi-select). */
  readonly pages: ReadonlyArray<ThreadListPage>;
  readonly availablePages: ReadonlyArray<ThreadListPage>;
  readonly onTogglePage: (page: ThreadListPage) => void;
  readonly groups: ThreadGroups;
  /** Adds "New group…" to Show; omitted when no environment supports groups. */
  readonly onCreateGroup?: () => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
}
