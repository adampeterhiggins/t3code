import { createGoogleEnvironmentAtoms } from "@t3tools/client-runtime/state/google";
import { connectionAtomRuntime } from "../connection/runtime";
export const googleEnvironment = createGoogleEnvironmentAtoms(connectionAtomRuntime);
