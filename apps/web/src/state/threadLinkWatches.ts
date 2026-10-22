import { createThreadLinkWatchEnvironmentAtoms } from "@t3tools/client-runtime/state/threadLinkWatches";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadLinkWatchEnvironment =
  createThreadLinkWatchEnvironmentAtoms(connectionAtomRuntime);
