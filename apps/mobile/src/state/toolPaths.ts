import { createToolPathRootsAtoms } from "@t3tools/client-runtime/work-log/tool-paths";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

export const toolPathRootsAtom = createToolPathRootsAtoms({
  threadsAtom: environmentThreadShells.environmentThreadsAtom,
  projectsAtom: environmentProjects.environmentProjectsAtom,
});
