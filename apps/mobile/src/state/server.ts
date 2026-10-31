import type { EnvironmentTheme } from "@t3tools/contracts";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import {
  createOutdatedServerDescriptionCommand,
  createOutdatedServerUpdateCommand,
} from "@t3tools/client-runtime/state/outdatedServerUpdate";
import { createEnvironmentServerConfigsAtom } from "@t3tools/client-runtime/state/shell";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";
import { createThreadListEnvironmentsAtom } from "./thread-list-environments";

export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
  environmentThemes: true,
  usageLimitSources: true,
  usageLimitsCommand: true,
});
export const describeOutdatedServer = createOutdatedServerDescriptionCommand(connectionAtomRuntime);
export const updateOutdatedServer = createOutdatedServerUpdateCommand(connectionAtomRuntime);
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

export const threadListEnvironmentsAtom = createThreadListEnvironmentsAtom(
  environmentServerConfigsAtom,
);

/** Themes published by every connected environment; the first environment wins a shared id. */
export const publishedEnvironmentThemesAtom = Atom.make((get): ReadonlyArray<EnvironmentTheme> => {
  const themes = new Map<string, EnvironmentTheme>();
  for (const config of get(environmentServerConfigsAtom).values()) {
    for (const theme of config.environmentThemes ?? []) {
      if (!themes.has(theme.id)) themes.set(theme.id, theme);
    }
  }
  const next = [...themes.values()];
  const previous = Option.getOrNull(get.self<ReadonlyArray<EnvironmentTheme>>());
  return previous !== null && Equal.equals(previous, next) ? previous : next;
}).pipe(Atom.withLabel("mobile-published-environment-themes"));
