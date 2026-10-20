import { createDiscordEnvironmentAtoms } from "@t3tools/client-runtime/state/discord";

import { connectionAtomRuntime } from "../connection/runtime";

export const discordEnvironment = createDiscordEnvironmentAtoms(connectionAtomRuntime);
