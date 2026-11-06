import type { EnvironmentId, EnvironmentTheme } from "@t3tools/contracts";
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

export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
  environmentThemes: true,
  usageLimitSources: true,
  usageLimitsCommand: true,
  providerCatalogsOnDemand: true,
});
export const describeOutdatedServer = createOutdatedServerDescriptionCommand(connectionAtomRuntime);
export const updateOutdatedServer = createOutdatedServerUpdateCommand(connectionAtomRuntime);
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

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

/** Connected environments that let this device publish, edit and delete themes. */
export const themeEditingEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> =>
  [...get(environmentServerConfigsAtom).keys()].filter((environmentId) =>
    get(serverEnvironment.publishEnvironmentTheme.permissionAtom(environmentId)),
  ),
).pipe(Atom.withLabel("mobile-theme-editing-environment-ids"));
