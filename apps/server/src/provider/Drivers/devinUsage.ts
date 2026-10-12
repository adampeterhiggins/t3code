/**
 * Usage history for the Devin CLI: every instance's `devin/cli/sessions.db`,
 * which holds each CLI session, including the ones T3 drives over ACP.
 *
 * @module provider/Drivers/devinUsage
 */
import type { DevinSettings } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import type { ProviderUsageReader, ProviderUsageScan } from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { readDevinUsage } from "./devinUsageReader.ts";

export type DevinUsageReaderEnv = FileSystem.FileSystem | Path.Path;

export const devinUsageReader: ProviderUsageReader<DevinSettings, DevinUsageReaderEnv> = {
  kind: "scan",
  provider: "devin",
  scan: Effect.fn("devinUsageReader.scan")(function* ({ instances, windowStartMs }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    const platform = yield* HostProcess.Platform;
    const scanned: ProviderUsageScan[] = [];
    const seen = new Set<string>();
    for (const { config, environment } of instances) {
      // The driver points XDG_DATA_HOME at a configured home directory.
      const configuredHome = config?.homePath.trim();
      const userHome = (platform === "win32" ? environment.USERPROFILE : environment.HOME) || home;
      const dataHome = environment.XDG_DATA_HOME?.trim();
      const dataRoot = configuredHome
        ? path.resolve(expandHomePath(configuredHome, home))
        : dataHome && path.isAbsolute(dataHome)
          ? dataHome
          : path.join(userHome, ".local", "share");
      const cliDir = path.join(dataRoot, "devin", "cli");
      const dir = yield* fileSystem.realPath(cliDir).pipe(Effect.orElseSucceed(() => cliDir));
      if (seen.has(dir)) continue;
      seen.add(dir);
      const result = yield* Effect.promise(() => readDevinUsage(dir, windowStartMs));
      if (result.missing) continue;
      scanned.push({
        dir,
        files: result.files,
        status: result.error ? "partial" : "ok",
        message: result.error
          ? "Some Devin CLI history could not be read."
          : "Devin usage is read from the Devin CLI's local session history.",
      });
    }
    return scanned;
  }),
};
