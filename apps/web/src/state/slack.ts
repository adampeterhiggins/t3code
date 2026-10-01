import { createSlackEnvironmentAtoms } from "@t3tools/client-runtime/state/slack";

import { connectionAtomRuntime } from "../connection/runtime";

export const slackEnvironment = createSlackEnvironmentAtoms(connectionAtomRuntime);
