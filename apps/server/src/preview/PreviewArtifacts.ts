import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export class PreviewScreenshotSaveError extends Schema.TaggedError<PreviewScreenshotSaveError>()(
  "PreviewScreenshotSaveError",
  { screenshotPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not save preview screenshot to ${this.screenshotPath}.`;
  }
}

export class PreviewArtifacts extends Context.Service<
  PreviewArtifacts,
  {
    readonly saveScreenshot: (
      pageUrl: string,
      data: Uint8Array,
    ) => Effect.Effect<string, PreviewScreenshotSaveError>;
  }
>()("t3/preview/PreviewArtifacts") {}

const MAX_SCREENSHOT_SITE_SLUG_LENGTH = 40;

/** Hostname reduced to a filename-safe slug, matching the desktop's own screenshot names. */
const screenshotSiteSlug = (rawUrl: string): string => {
  try {
    const slug = new URL(rawUrl).hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SCREENSHOT_SITE_SLUG_LENGTH)
      .replace(/-+$/g, "");
    return slug || "site";
  } catch {
    return "site";
  }
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  /** Writes the snapshot PNG under the browser artifacts directory and returns its path. */
  const saveScreenshot = Effect.fn("PreviewArtifacts.saveScreenshot")(function* (
    pageUrl: string,
    data: Uint8Array,
  ) {
    const millis = yield* Clock.currentTimeMillis;
    // Two saves in the same millisecond must not overwrite each other.
    const unique = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).slice(0, 8);
    const fileName = `browser-screenshot-${screenshotSiteSlug(pageUrl)}-${millis.toString(36)}-${unique}.png`;
    const screenshotPath = path.join(config.browserArtifactsDir, fileName);
    yield* fileSystem.makeDirectory(config.browserArtifactsDir, { recursive: true }).pipe(
      Effect.andThen(fileSystem.writeFile(screenshotPath, data)),
      Effect.mapError((cause) => new PreviewScreenshotSaveError({ screenshotPath, cause })),
    );
    return screenshotPath;
  });

  return PreviewArtifacts.of({ saveScreenshot });
});

export const layer = Layer.effect(PreviewArtifacts, make);
