import { createGranolaEnvironmentAtoms } from "@t3tools/client-runtime/state/granola";
import { connectionAtomRuntime } from "../connection/runtime";
export const granolaEnvironment = createGranolaEnvironmentAtoms(connectionAtomRuntime);
