import { SKILL_CHIP_ICON_SVG } from "../composerInlineChip";

export function SkillChipIcon() {
  return (
    <span
      aria-hidden="true"
      className="contents"
      dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
    />
  );
}
