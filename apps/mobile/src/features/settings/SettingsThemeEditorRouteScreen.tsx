import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentId, EnvironmentTheme } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme, ScopedVariables } from "uniwind";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import {
  environmentMobileThemeId,
  environmentThemeFileFromSeeds,
  environmentThemeSeeds,
  getEnvironmentThemeVariables,
  isThemeHexColor,
  newEnvironmentThemeId,
  type MobileThemeAppearance,
} from "../../lib/mobileTheme";
import { getMobileUniwindThemeName } from "../../lib/mobileThemeRuntime";
import {
  publishedEnvironmentThemesAtom,
  serverEnvironment,
  themeEditingEnvironmentIdsAtom,
} from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { PreviewOrb, PreviewPane } from "./appearance/sections/ThemeAppearanceSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { leaveSettingsPage } from "./settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const CANVAS_PRESETS: Readonly<Record<MobileThemeAppearance, ReadonlyArray<string>>> = {
  light: ["#ffffff", "#f7f4ee", "#eef3f8", "#f3eff8", "#eef6f0"],
  dark: ["#111111", "#14161f", "#1a1423", "#10201a", "#22160f"],
};
const ACCENT_PRESETS = [
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#30a46c",
  "#0090ff",
  "#8e4ec6",
  "#d6409f",
];
const DRAFT_ID = "draft";

function ColorField(props: {
  readonly label: string;
  readonly value: string;
  readonly presets: ReadonlyArray<string>;
  readonly onChange: (value: string) => void;
}) {
  const valid = isThemeHexColor(props.value);
  return (
    <View className="gap-3 p-4">
      <Text className="text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      <View className="flex-row items-center gap-3">
        <View
          className="size-11 rounded-xl border border-border"
          style={valid ? { backgroundColor: props.value } : undefined}
        />
        <AppTextInput
          accessibilityLabel={`${props.label} hex color`}
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
          maxLength={7}
          placeholder="#rrggbb"
          value={props.value}
          onChangeText={(value) => props.onChange(value.startsWith("#") ? value : `#${value}`)}
        />
      </View>
      {valid ? null : (
        <Text className="text-sm text-danger-foreground">Use a hex color such as #1a2b3c.</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {props.presets.map((preset) => (
          <Pressable
            accessibilityLabel={`${props.label} ${preset}`}
            accessibilityRole="button"
            accessibilityState={{ selected: preset === props.value.toLowerCase() }}
            className={
              preset === props.value.toLowerCase()
                ? "size-9 rounded-full border-[3px] border-primary"
                : "size-9 rounded-full border border-border"
            }
            key={preset}
            style={{ backgroundColor: preset }}
            onPress={() => props.onChange(preset)}
          />
        ))}
      </View>
    </View>
  );
}

export function SettingsThemeEditorRouteScreen({
  route,
}: StaticScreenProps<{ readonly themeId?: string }>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const published = useAtomValue(publishedEnvironmentThemesAtom);
  const environmentIds = useAtomValue(themeEditingEnvironmentIdsAtom);
  const publishTheme = useAtomCommand(serverEnvironment.publishEnvironmentTheme, {
    label: "publish environment theme",
    reportFailure: false,
  });
  const unpublishTheme = useAtomCommand(serverEnvironment.unpublishEnvironmentTheme, {
    label: "unpublish environment theme",
    reportFailure: false,
  });
  const existing = published.find((theme) => theme.id === route.params?.themeId) ?? null;
  const [initial] = useState(() => {
    const seeds = existing === null ? null : environmentThemeSeeds(existing);
    return {
      name: existing?.name ?? "",
      appearance: existing?.appearance ?? ("dark" as MobileThemeAppearance),
      canvas: seeds?.canvas ?? CANVAS_PRESETS.dark[1]!,
      accent: seeds?.accent ?? ACCENT_PRESETS[4]!,
    };
  });
  const [name, setName] = useState(initial.name);
  const [appearance, setAppearance] = useState(initial.appearance);
  const [canvas, setCanvas] = useState(initial.canvas);
  const [accent, setAccent] = useState(initial.accent);
  const [pending, setPending] = useState(false);

  const valid = name.trim().length > 0 && isThemeHexColor(canvas) && isThemeHexColor(accent);
  const draft: EnvironmentTheme | null = valid
    ? {
        id: DRAFT_ID,
        ...environmentThemeFileFromSeeds({ existing, name, appearance, canvas, accent }),
      }
    : null;
  const previewAppearance = existing?.appearance ?? appearance;
  const draftVariables =
    draft === null ? null : getEnvironmentThemeVariables(draft, previewAppearance);
  const hasTunedColors = existing !== null && existing.colors !== undefined;

  const leave = () => leaveSettingsPage(navigation, workspaceHasColumns(), "SettingsAppearance");

  const runOnEnvironments = async (
    targets: ReadonlyArray<EnvironmentId>,
    run: (environmentId: EnvironmentId) => ReturnType<typeof publishTheme>,
  ) => {
    const failures: string[] = [];
    for (const environmentId of targets) {
      const result = await run(environmentId);
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) continue;
      const error = squashAtomCommandFailure(result);
      failures.push(error instanceof Error ? error.message : String(error));
    }
    return failures;
  };

  const save = async () => {
    if (!valid || pending || environmentIds.length === 0) return;
    setPending(true);
    const id =
      existing?.id ??
      newEnvironmentThemeId(
        name,
        published.map((theme) => theme.id),
      );
    const theme = environmentThemeFileFromSeeds({ existing, name, appearance, canvas, accent });
    const failures = await runOnEnvironments(environmentIds, (environmentId) =>
      publishTheme({ environmentId, input: { id, theme } }),
    );
    setPending(false);
    if (failures.length === environmentIds.length) {
      Dialog.alert("Could not save theme", failures.join("\n\n"));
      return;
    }
    leave();
  };

  const remove = () => {
    if (existing === null) return;
    Dialog.confirm({
      title: "Delete theme",
      message: `${existing.name} will no longer be available on any device connected to these environments. Devices using it keep a copy.`,
      confirmText: "Delete theme",
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setPending(true);
          const failures = await runOnEnvironments(environmentIds, (environmentId) =>
            unpublishTheme({ environmentId, input: { id: existing.id } }),
          );
          setPending(false);
          if (failures.length > 0) {
            Dialog.alert("Could not delete theme", failures.join("\n\n"));
            return;
          }
          leave();
        })();
      },
    });
  };

  return (
    <SettingsScreen title={existing === null ? "Create theme" : "Edit theme"}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="flex-row items-center justify-center gap-4">
          {draft !== null && draftVariables !== null ? (
            <>
              <PreviewOrb
                appearance={previewAppearance}
                environmentThemes={[draft]}
                themeId={environmentMobileThemeId(DRAFT_ID)}
              />
              <ScopedTheme
                theme={getMobileUniwindThemeName(
                  environmentMobileThemeId(DRAFT_ID),
                  previewAppearance,
                )}
              >
                <ScopedVariables variables={draftVariables}>
                  <View className="h-36 w-20 rounded-[18px] border-[1.5px] border-border bg-drawer p-[3px]">
                    <View className="flex-1 overflow-hidden rounded-[13px]">
                      <PreviewPane />
                    </View>
                  </View>
                </ScopedVariables>
              </ScopedTheme>
            </>
          ) : (
            <Text className="text-sm text-foreground-muted">Name the theme to preview it.</Text>
          )}
        </View>

        <SettingsSection title="Theme">
          <View className="gap-3 p-4">
            <Text className="text-sm font-t3-medium text-foreground-muted">Name</Text>
            <AppTextInput
              accessibilityLabel="Theme name"
              className="min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              maxLength={48}
              placeholder="My theme"
              returnKeyType="done"
              value={name}
              onChangeText={setName}
            />
          </View>
          {existing === null ? (
            <View className="px-4 pb-4">
              <SegmentedControl
                options={APPEARANCE_OPTIONS}
                selected={appearance}
                onSelect={(value) => {
                  setAppearance(value);
                  if (CANVAS_PRESETS[appearance].includes(canvas)) {
                    setCanvas(CANVAS_PRESETS[value][CANVAS_PRESETS[appearance].indexOf(canvas)]!);
                  }
                }}
              />
            </View>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="Colors"
          {...(hasTunedColors
            ? {
                footer:
                  "Changing a color rebuilds this theme from its background and accent, replacing colors fine-tuned on desktop.",
              }
            : {})}
        >
          <ColorField
            label="Background"
            presets={CANVAS_PRESETS[previewAppearance]}
            value={canvas}
            onChange={setCanvas}
          />
          <ColorField label="Accent" presets={ACCENT_PRESETS} value={accent} onChange={setAccent} />
        </SettingsSection>

        <SettingsSection footer="Saved themes are shared with every device connected to your environments.">
          <SettingsActionRow
            icon="checkmark.circle"
            label={existing === null ? "Create theme" : "Save theme"}
            disabled={!valid || pending || environmentIds.length === 0}
            loading={pending}
            onPress={() => void save()}
          />
          {existing !== null ? (
            <SettingsActionRow
              icon="trash"
              label="Delete theme"
              tone="danger"
              disabled={pending}
              onPress={remove}
            />
          ) : null}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
