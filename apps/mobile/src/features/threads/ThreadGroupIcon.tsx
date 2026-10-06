import type { ThreadGroup } from "@t3tools/contracts/settings";
import { memo } from "react";

import { SymbolView } from "../../components/AppSymbol";
import { ProjectIconGlyphView } from "../../components/ProjectFavicon";
import { projectIconColorClassNames, resolveProjectIconGlyph } from "../../lib/projectIcon";

/** A group's icon, or a folder tinted with its accent when it has none. */
export const ThreadGroupIcon = memo(function ThreadGroupIcon(props: {
  readonly name: string;
  readonly style: ThreadGroup | undefined;
  readonly size: number;
  /** Tint for the unstyled folder. */
  readonly fallbackTintClassName: string;
}) {
  const glyph = resolveProjectIconGlyph(props.style?.icon, props.name);
  if (glyph !== null) return <ProjectIconGlyphView glyph={glyph} size={props.size} />;
  const accent = props.style?.accent;
  return (
    <SymbolView
      name="folder"
      size={props.size}
      tintColorClassName={
        accent === undefined ? props.fallbackTintClassName : projectIconColorClassNames(accent).tint
      }
      type="monochrome"
    />
  );
});
