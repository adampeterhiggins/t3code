import * as Schema from "effect/Schema";

/**
 * Wire snapshot of a committed appearance preference. Theme ids and custom
 * theme entries stay unchecked here so an environment palette that has not
 * arrived yet still round-trips; the web theme parser validates entries when
 * a renderer adopts the snapshot.
 */
export const DesktopAppearanceMode = Schema.Literals(["light", "dark", "system"]);
export type DesktopAppearanceMode = typeof DesktopAppearanceMode.Type;

export const DesktopAppearanceHalves = Schema.Struct({
  light: Schema.optional(Schema.String),
  dark: Schema.optional(Schema.String),
});
export type DesktopAppearanceHalves = typeof DesktopAppearanceHalves.Type;

export const DesktopAppearanceSnapshot = Schema.Struct({
  theme: Schema.String,
  appearanceMode: DesktopAppearanceMode,
  halves: Schema.NullOr(DesktopAppearanceHalves),
  customThemes: Schema.Array(Schema.Unknown),
});
export type DesktopAppearanceSnapshot = typeof DesktopAppearanceSnapshot.Type;
