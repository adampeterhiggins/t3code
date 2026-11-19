import {
  EDITORS,
  type EditorId,
  type CustomEditor,
  type CustomEditorIcon,
  type FileOpenTarget,
} from "@t3tools/contracts";
import { resolveCustomEditorIcon, resolveCustomEditorIconOptions } from "../editorIcons";
import { randomUUID } from "../../lib/utils";
import { editorLabelForPlatform } from "../../editorLabels";
import { Textarea } from "../ui/textarea";
import { useState } from "react";
import { T, useGT } from "gt-react";
import { useEnvironments } from "../../state/environments";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function OpenInSettings() {
  const gt = useGT();
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { targets, scope } = useSettingsScope();
  const { environments } = useEnvironments();
  const environment = environments.find(
    (entry) => entry.environmentId === targets[0]?.environmentId,
  );
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [icon, setIcon] = useState<CustomEditorIcon>("folder");
  const iconOptions = resolveCustomEditorIconOptions(navigator.platform);
  const selectedIcon = resolveCustomEditorIcon(icon, navigator.platform);
  const [runInShell, setRunInShell] = useState(false);
  const [editingId, setEditingId] = useState<CustomEditor["id"] | null>(null);
  const [extension, setExtension] = useState("");
  const [ruleTarget, setRuleTarget] = useState<FileOpenTarget>("t3");
  // Commands are machine-specific; select one environment before editing them.
  const disabled = targets.length !== 1 || scope.kind === "project" || scope.kind === "checkout";
  const options: { id: FileOpenTarget; label: string }[] = [
    { id: "t3", label: gt("T3 file viewer") },
    ...EDITORS.filter((editor) =>
      environment?.serverConfig?.availableEditors.includes(editor.id),
    ).map((editor) => ({
      id: editor.id,
      label: editor.id === "file-manager" ? gt("System default application") : editor.label,
    })),
    ...settings.customEditors.map((editor) => ({ id: editor.id, label: editor.label })),
  ];
  const workspaceOptions: { id: EditorId; label: string }[] = [
    ...EDITORS.filter((editor) =>
      environment?.serverConfig?.availableEditors.includes(editor.id),
    ).map((editor) => ({
      id: editor.id,
      label: editorLabelForPlatform(editor.id, navigator.platform),
    })),
    ...settings.customEditors.map((editor) => ({ id: editor.id, label: editor.label })),
  ];
  const picker = (
    value: FileOpenTarget,
    onChange: (value: FileOpenTarget) => void,
    name: string,
  ) => (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (options.some((option) => option.id === next)) onChange(next as FileOpenTarget);
      }}
    >
      <SelectTrigger aria-label={name}>
        <SelectValue>
          {options.find((option) => option.id === value)?.label ?? gt("Unavailable application")}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
  const parsedArgs = args
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((arg) => arg.trim().length > 0);
  function resetForm() {
    setEditingId(null);
    setLabel("");
    setCommand("");
    setArgs("");
    setRunInShell(false);
    setIcon("folder");
  }
  function removeEditor(id: EditorId) {
    update({
      customEditors: settings.customEditors.filter((editor) => editor.id !== id),
      fileOpenDefault: settings.fileOpenDefault === id ? "t3" : settings.fileOpenDefault,
      fileOpenRules: settings.fileOpenRules.filter((rule) => rule.target !== id),
      workspaceOpenDefault:
        settings.workspaceOpenDefault === id ? null : settings.workspaceOpenDefault,
    });
    if (ruleTarget === id) setRuleTarget("t3");
    if (editingId === id) resetForm();
  }
  return (
    <SettingsSection id="open-in" title={gt("Open in")}>
      <SettingsRow
        title={gt("Workspace Open button")}
        description={gt(
          "Choose what the Open button and its shortcut use. Last used remembers your most recent pick on each device.",
        )}
        control={
          <Select
            value={settings.workspaceOpenDefault ?? "last-used"}
            disabled={disabled}
            onValueChange={(next) => {
              if (next === "last-used") update({ workspaceOpenDefault: null });
              const option = workspaceOptions.find((candidate) => candidate.id === next);
              if (option) update({ workspaceOpenDefault: option.id });
            }}
          >
            <SelectTrigger aria-label={gt("Workspace Open button application")}>
              <SelectValue>
                {settings.workspaceOpenDefault === null
                  ? gt("Last used")
                  : (workspaceOptions.find((option) => option.id === settings.workspaceOpenDefault)
                      ?.label ?? gt("Unavailable application"))}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="last-used">
                <T>Last used</T>
              </SelectItem>
              {workspaceOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={gt("File links")}
        description={gt(
          "Choose what opens when you click a file link in chat. Applications run on the environment hosting the file.",
        )}
        control={picker(
          settings.fileOpenDefault,
          (fileOpenDefault) => update({ fileOpenDefault }),
          gt("Default file application"),
        )}
      />
      <SettingsRow
        title={gt("File extensions")}
        description={gt(
          "Override the default for extensions such as .md. Remove a rule to use the default again.",
        )}
      >
        <div className="space-y-2">
          {settings.fileOpenRules.map((rule, index) => (
            <div key={rule.extension} className="flex items-center gap-2">
              <span className="flex-1 text-sm">
                {rule.extension} →{" "}
                {options.find((option) => option.id === rule.target)?.label ??
                  gt("Unavailable application")}
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                aria-label={gt("Remove {extension} rule", { extension: rule.extension })}
                onClick={() =>
                  update({ fileOpenRules: settings.fileOpenRules.filter((_, i) => i !== index) })
                }
              >
                <T context="verb, removes a rule">Remove</T>
              </Button>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
            <Input
              aria-label={gt("File extension")}
              placeholder=".md"
              value={extension}
              disabled={disabled}
              onChange={(event) => setExtension(event.target.value)}
            />
            {picker(ruleTarget, setRuleTarget, gt("Extension application"))}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !/^\.?[\w-]+$/.test(extension.trim())}
              onClick={() => {
                const normalized = `.${extension.trim().replace(/^\./, "").toLowerCase()}`;
                update({
                  fileOpenRules: [
                    ...settings.fileOpenRules.filter((rule) => rule.extension !== normalized),
                    { extension: normalized, target: ruleTarget },
                  ],
                });
                setExtension("");
              }}
            >
              <T>Save rule</T>
            </Button>
          </div>
        </div>
      </SettingsRow>
      <SettingsRow
        title={gt("Custom applications")}
        description={
          disabled
            ? gt("Select a single environment to configure applications.")
            : gt(
                "Enter an executable and arguments, one per line; the file path is appended. For Typora on macOS, use command open with arguments -a and Typora. Run in my shell allows aliases and shell functions.",
              )
        }
      >
        <div className="space-y-2">
          {settings.customEditors.map((editor) => {
            const { Icon, kind } = resolveCustomEditorIcon(editor.icon, navigator.platform);
            return (
              <div key={editor.id} className="flex items-center gap-2">
                <Icon
                  aria-hidden="true"
                  className={
                    kind === "brand"
                      ? "size-4 text-foreground opacity-100"
                      : "size-4 text-muted-foreground"
                  }
                />
                <span className="flex-1 text-sm">
                  {editor.runInShell
                    ? gt("{name} · {command} (shell)", {
                        name: editor.label,
                        command: editor.command,
                      })
                    : `${editor.label} · ${editor.command}`}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setEditingId(editor.id);
                    setLabel(editor.label);
                    setCommand(editor.command);
                    setArgs(editor.args.join("\n"));
                    setRunInShell(editor.runInShell === true);
                    setIcon(editor.icon ?? "folder");
                  }}
                >
                  <T context="verb">Edit</T>
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  aria-label={gt("Remove {name}", { name: editor.label })}
                  onClick={() => removeEditor(editor.id)}
                >
                  <T context="verb, removes an application">Remove</T>
                </Button>
              </div>
            );
          })}
          <div className="space-y-1 text-sm">
            <span>
              <T>Icon</T>
            </span>
            <Select
              value={icon}
              disabled={disabled}
              onValueChange={(next) => {
                const option = iconOptions.find((candidate) => candidate.value === next);
                if (option) setIcon(option.value);
              }}
            >
              <SelectTrigger aria-label={gt("Application icon")}>
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <selectedIcon.Icon
                      aria-hidden="true"
                      className={
                        selectedIcon.kind === "brand"
                          ? "size-4 text-foreground opacity-100"
                          : "size-4 text-muted-foreground"
                      }
                    />
                    {selectedIcon.label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {iconOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-2">
                      <option.Icon
                        aria-hidden="true"
                        className={
                          option.kind === "brand"
                            ? "size-4 text-foreground opacity-100"
                            : "size-4 text-muted-foreground"
                        }
                      />
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Input
            aria-label={gt("Application name")}
            // oxlint-disable-next-line t3code/no-untranslated-copy -- application name
            placeholder="Typora"
            value={label}
            disabled={disabled}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Input
            aria-label={gt("Application command")}
            placeholder="open"
            value={command}
            disabled={disabled}
            onChange={(event) => setCommand(event.target.value)}
          />
          <Textarea
            aria-label={gt("Application arguments")}
            // oxlint-disable-next-line t3code/no-untranslated-copy -- command-line arguments
            placeholder={"-a\nTypora"}
            value={args}
            disabled={disabled}
            onChange={(event) => setArgs(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={runInShell}
              disabled={disabled}
              onCheckedChange={(checked) => setRunInShell(checked === true)}
            />
            <T>Run in my shell (macOS and Linux)</T>
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !label.trim() || !command.trim()}
            onClick={() => {
              update({
                customEditors: [
                  ...settings.customEditors.filter((editor) => editor.id !== editingId),
                  {
                    id: editingId ?? `custom:${randomUUID()}`,
                    label: label.trim(),
                    command: command.trim(),
                    args: parsedArgs,
                    ...(icon === "folder" ? {} : { icon }),
                    ...(runInShell ? { runInShell: true } : {}),
                  },
                ],
              });
              resetForm();
            }}
          >
            {editingId ? <T>Save application</T> : <T>Add application</T>}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm}>
              <T>Cancel</T>
            </Button>
          )}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
