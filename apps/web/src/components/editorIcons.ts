import { type EDITORS, type CustomEditorIcon } from "@t3tools/contracts";
import { CodeIcon, FolderClosedIcon, GlobeIcon, TerminalIcon } from "lucide-react";
import { editorLabelForPlatform } from "../editorLabels";
import { msg } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";
import { isMacPlatform, isWindowsPlatform } from "../lib/utils";
import {
  AntigravityIcon,
  CursorIcon,
  FileExplorerIcon,
  FinderIcon,
  type Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "./Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "./JetBrainsIcons";

export interface EditorIconOption {
  readonly Icon: Icon;
  readonly value: (typeof EDITORS)[number]["id"];
  readonly kind: "brand" | "generic";
}

/** Editor logos in picker order. */
export function editorIconOptions(platform: string): ReadonlyArray<EditorIconOption> {
  return [
    {
      Icon: CursorIcon,
      value: "cursor",
      kind: "brand",
    },
    {
      Icon: TraeIcon,
      value: "trae",
      kind: "brand",
    },
    {
      Icon: KiroIcon,
      value: "kiro",
      kind: "brand",
    },
    {
      Icon: VisualStudioCode,
      value: "vscode",
      kind: "brand",
    },
    {
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
      kind: "brand",
    },
    {
      Icon: VSCodium,
      value: "vscodium",
      kind: "brand",
    },
    {
      Icon: Zed,
      value: "zed",
      kind: "brand",
    },
    {
      Icon: AntigravityIcon,
      value: "antigravity",
      kind: "brand",
    },
    {
      Icon: IntelliJIdeaIcon,
      value: "idea",
      kind: "brand",
    },
    {
      Icon: AquaIcon,
      value: "aqua",
      kind: "brand",
    },
    {
      Icon: CLionIcon,
      value: "clion",
      kind: "brand",
    },
    {
      Icon: DataGripIcon,
      value: "datagrip",
      kind: "brand",
    },
    {
      Icon: DataSpellIcon,
      value: "dataspell",
      kind: "brand",
    },
    {
      Icon: GoLandIcon,
      value: "goland",
      kind: "brand",
    },
    {
      Icon: PhpStormIcon,
      value: "phpstorm",
      kind: "brand",
    },
    {
      Icon: PyCharmIcon,
      value: "pycharm",
      kind: "brand",
    },
    {
      Icon: RiderIcon,
      value: "rider",
      kind: "brand",
    },
    {
      Icon: RubyMineIcon,
      value: "rubymine",
      kind: "brand",
    },
    {
      Icon: RustRoverIcon,
      value: "rustrover",
      kind: "brand",
    },
    {
      Icon: WebStormIcon,
      value: "webstorm",
      kind: "brand",
    },
    {
      Icon: isMacPlatform(platform)
        ? FinderIcon
        : isWindowsPlatform(platform)
          ? FileExplorerIcon
          : FolderClosedIcon,
      value: "file-manager",
      kind: isMacPlatform(platform) || isWindowsPlatform(platform) ? "brand" : "generic",
    },
  ];
}

export function resolveCustomEditorIconOptions(platform: string, resolve: MessageResolver = m) {
  return [
    {
      value: "folder",
      label: resolve(msg("Folder (default)", { $context: "custom editor icon" })),
      Icon: FolderClosedIcon,
      kind: "generic",
    },
    {
      value: "terminal",
      label: resolve(msg("Terminal", { $context: "custom editor icon" })),
      Icon: TerminalIcon,
      kind: "generic",
    },
    {
      value: "code",
      label: resolve(msg("Code", { $context: "custom editor icon" })),
      Icon: CodeIcon,
      kind: "generic",
    },
    {
      value: "globe",
      label: resolve(msg("Globe", { $context: "custom editor icon" })),
      Icon: GlobeIcon,
      kind: "generic",
    },
    ...editorIconOptions(platform).map((option) => ({
      ...option,
      label: editorLabelForPlatform(option.value, platform, resolve),
    })),
  ] as const;
}

export function resolveCustomEditorIcon(icon: CustomEditorIcon | undefined, platform: string) {
  const options = resolveCustomEditorIconOptions(platform);
  return options.find((option) => option.value === icon) ?? options[0];
}
