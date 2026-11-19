import { useGT } from "gt-react-native";
import {
  BASE_FONT_SIZE_STEP,
  MAX_BASE_FONT_SIZE,
  MIN_BASE_FONT_SIZE,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TextAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { SliderRow } from "../../../../components/ui/SliderRow";
import { MAX_APPEARANCE_CONTRAST, MIN_APPEARANCE_CONTRAST } from "@t3tools/contracts/settings";

export function TextAppearanceSection() {
  const gt = useGT();
  const {
    isReady,
    appearance,
    setBaseFontSize,
    mathRenderingEnabled,
    setMathRenderingEnabled,
    appearanceContrast,
    setAppearanceContrast,
  } = useAppearancePreferences();

  return (
    <SettingsSection title={gt("Text", { $context: "settings section for text size" })}>
      <TextAppearancePreview fontSize={appearance.baseFontSize} />
      <AppearancePreviewSeparator />
      <FontSizeSliderRow
        disabled={!isReady}
        icon="textformat.size"
        label={gt("Text size")}
        max={MAX_BASE_FONT_SIZE}
        min={MIN_BASE_FONT_SIZE}
        onChange={setBaseFontSize}
        step={BASE_FONT_SIZE_STEP}
        value={appearance.baseFontSize}
        valueLabel={gt("{size} pt", { size: appearance.baseFontSize })}
      />
      <SliderRow
        disabled={!isReady}
        icon="circle.inset.filled"
        label={gt("Contrast", { $context: "appearance setting" })}
        max={MAX_APPEARANCE_CONTRAST}
        min={MIN_APPEARANCE_CONTRAST}
        onChange={setAppearanceContrast}
        step={10}
        value={appearanceContrast}
        valueLabel={gt("{percent}%", { percent: appearanceContrast })}
      />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="plusminus"
        label={gt("Render math")}
        value={mathRenderingEnabled}
        onValueChange={setMathRenderingEnabled}
      />
    </SettingsSection>
  );
}
