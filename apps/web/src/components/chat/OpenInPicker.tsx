import { useAtomValue } from "@effect/atom-react";
import { serverEnvironment } from "../../state/server";
import {
  buildRemoteOpenUrl,
  EditorId,
  type CustomEditor,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { useAvailableEditors, usePreferredEditor } from "../../editorPreferences";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenHint,
  useRemoteOpenState,
} from "../../remoteOpen";
import { useEnvironment } from "../../state/environments";
import { ChevronDownIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
  MenuTrigger,
} from "../ui/menu";
import type { Icon } from "../Icons";
import { resolveEditorIconOptions, resolveCustomEditorIcon } from "../editorIcons";
import { cn } from "~/lib/utils";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

type OpenInOption = {
  label: string;
  Icon: Icon;
  value: EditorId;
  kind: "brand" | "generic";
};

export const resolveOpenInOptions = (
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
  customEditors: readonly CustomEditor[] = [],
) => {
  const availableEditorSet = new Set(availableEditors);
  return [
    ...resolveEditorIconOptions(platform).filter((option) => availableEditorSet.has(option.value)),
    ...customEditors
      .filter((editor) => availableEditorSet.has(editor.id))
      .map((editor): OpenInOption => {
        const { Icon, kind } = resolveCustomEditorIcon(editor.icon, platform);
        return { value: editor.id, label: editor.label, Icon, kind };
      }),
  ];
};

export function resolveOpenInEditorIds(
  mode: "local-exec" | "remote-links" | "remote-unavailable",
  detected: readonly EditorId[],
  remoteEditors: readonly EditorId[],
  customEditors: readonly CustomEditor[],
): readonly EditorId[] {
  return [
    ...new Set([
      ...(mode === "local-exec" ? detected : mode === "remote-links" ? remoteEditors : []),
      ...customEditors.map((editor) => editor.id),
    ]),
  ];
}

function getOpenInIconClass(kind: OpenInOption["kind"]) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  presentation = "toolbar",
  compact = false,
  enableShortcut = true,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  presentation?: "toolbar" | "menu";
  compact?: boolean;
  enableShortcut?: boolean;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  const [remoteHintSeen, markRemoteHintSeen] = useRemoteOpenHint();
  const environment = useEnvironment(environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const customEditors = settings?.customEditors ?? [];
  const workspaceOpenDefault = settings?.workspaceOpenDefault ?? null;
  const localEditors = useAvailableEditors(environmentId, availableEditors);
  const environmentLabel = environment?.label ?? "this machine";
  // Remote mode ignores the server's PATH probe: what matters is what runs on
  // the viewing machine, which only the desktop app can probe.
  const effectiveEditors = useMemo(
    () => resolveOpenInEditorIds(remote.mode, localEditors, remoteCapableEditors, customEditors),
    [remote.mode, localEditors, remoteCapableEditors, customEditors],
  );
  const [lastUsedEditor, setLastUsedEditor] = usePreferredEditor(effectiveEditors);
  const pinnedEditor =
    workspaceOpenDefault !== null && effectiveEditors.includes(workspaceOpenDefault)
      ? workspaceOpenDefault
      : null;
  const preferredEditor = pinnedEditor ?? lastUsedEditor;
  // File opens elsewhere follow last-used, so opening the pinned app must not overwrite it.
  const setPreferredEditor = useCallback(
    (editor: EditorId) => {
      if (editor !== pinnedEditor) setLastUsedEditor(editor);
    },
    [pinnedEditor, setLastUsedEditor],
  );
  const options = useMemo(
    () => resolveOpenInOptions(navigator.platform, effectiveEditors, customEditors),
    [effectiveEditors, customEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;
  const preferredUnavailable =
    remote.mode === "remote-unavailable" && !preferredEditor?.startsWith("custom:");

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      if (!openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      const custom = editor.startsWith("custom:");
      if (remote.mode === "remote-unavailable" && !custom) return;
      if (remote.mode === "remote-links" && !custom) {
        const url = buildRemoteOpenUrl({
          editor,
          host: remote.host.host,
          absolutePath: openInCwd,
        });
        if (url === undefined) return;
        // Only record hint-seen/preferred when the shell actually accepted
        // the URL (an older desktop build can refuse the editor scheme).
        void openRemoteEditorUrl(url).then((opened) => {
          if (!opened) return;
          markRemoteHintSeen();
          setPreferredEditor(editor);
        });
        return;
      }
      const result = openInEditorMutation({
        environmentId,
        input: {
          cwd: openInCwd,
          editor,
        },
      });
      setPreferredEditor(editor);
      return result;
    },
    [
      environmentId,
      markRemoteHintSeen,
      openInCwd,
      openInEditorMutation,
      preferredEditor,
      remote,
      setPreferredEditor,
    ],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    if (!enableShortcut) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void openInEditor(preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcut, keybindings, openInCwd, openInEditor, preferredEditor]);

  const editorItems = (
    <>
      {remote.mode === "remote-unavailable" && (
        <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
          No SSH route to {environmentLabel}
        </MenuItem>
      )}
      <>
        {options.length === 0 && (
          <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
            No installed editors found
          </MenuItem>
        )}
        {options.map(({ label, Icon, value, kind }) => (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={value}
            onClick={() => openInEditor(value)}
          >
            <Icon aria-hidden="true" className={getOpenInIconClass(kind)} />
            <MenuItemLabel>
              {label}
              {remote.mode !== "local-exec" && value.startsWith("custom:")
                ? ` (on ${environmentLabel})`
                : ""}
            </MenuItemLabel>
            {value === preferredEditor && openFavoriteEditorShortcutLabel && (
              <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
        ))}
        {remote.mode === "remote-links" && !remoteHintSeen && (
          <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
            Opens over SSH. Needs your key on {environmentLabel}
          </MenuItem>
        )}
      </>
    </>
  );
  if (presentation === "menu") {
    return (
      <>
        {primaryOption && (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}

            disabled={!openInCwd || preferredUnavailable}
            onClick={() => openInEditor(preferredEditor)}
          >
            <primaryOption.Icon className={cn("size-4", getOpenInIconClass(primaryOption.kind))} />
            <MenuItemLabel>Open in {primaryOption.label}</MenuItemLabel>
            {openFavoriteEditorShortcutLabel && (
              <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
        )}
        <MenuSub>
          <MenuSubTrigger density="touch">
            <SquareArrowOutUpRightIcon className="size-4" />
            <MenuItemLabel>Open in…</MenuItemLabel>
          </MenuSubTrigger>
          <MenuSubPopup>{editorItems}</MenuSubPopup>
        </MenuSub>
      </>
    );
  }

  return (
    <Group aria-label="Open in editor">
      <Button
        aria-label={compact ? "Open file in preferred editor" : undefined}
        size="xs"
        variant="outline"
        disabled={!preferredEditor || !openInCwd || preferredUnavailable}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon && (
          <primaryOption.Icon
            aria-hidden="true"
            className={cn("size-3.5", getOpenInIconClass(primaryOption.kind))}
          />
        )}
        <span
          className={
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5"
          }
        >
          Open
        </span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Choose editor" size="icon-xs" variant="outline" />}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">{editorItems}</MenuPopup>
      </Menu>
    </Group>
  );
});
