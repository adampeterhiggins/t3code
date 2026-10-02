import { createNotionEnvironmentAtoms } from "@t3tools/client-runtime/state/notion";
import { connectionAtomRuntime } from "../connection/runtime";
export const notionEnvironment = createNotionEnvironmentAtoms(connectionAtomRuntime);
