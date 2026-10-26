import { useImperativeHandle, useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { isMacPlatform, DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { CommandPalette } from "./CommandPalette";
import { useComposerHandleContext } from "../composerHandleContext";
import { openCommandPalette } from "../commandPaletteBus";
import { primaryServerKeybindingsAtom } from "../state/server";

vi.mock("@effect/atom-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@effect/atom-react")>();
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === primaryServerKeybindingsAtom ? DEFAULT_RESOLVED_KEYBINDINGS : [],
  };
});
vi.mock("../hooks/useTheme", () => ({
  getRenderedAppearance: () => "light",
  subscribeRenderedAppearance: () => () => {},
  useRenderedAppearance: () => "light",
  useTheme: () => ({ theme: "default", resolvedTheme: "light", appearanceMode: "light" }),
}));
vi.mock("../hooks/useCustomThemes", () => ({ useCustomThemes: () => [] }));
vi.mock("../hooks/useEnvironmentTheme", () => ({ useEnvironmentThemeDefinitions: () => [] }));
vi.mock("../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useSettings")>()),
  useClientSettings: () => ({}),
}));
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ scratchEnvironmentId: () => null }),
}));
vi.mock("../hooks/useNewProject", () => ({ useNewProject: () => vi.fn() }));
vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeThread: null,
    activeDraftThread: null,
    defaultProjectRef: null,
    handleNewThread: vi.fn(),
  }),
  useNewThreadHandler: () => vi.fn(),
}));
vi.mock("../hooks/useOpenPanelPullRequestUrl", () => ({ useOpenPanelPullRequestUrl: () => null }));
vi.mock("../connection/useDesktopLocalBootstraps", () => ({ useDesktopLocalBootstraps: () => [] }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/environments")>()),
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironmentId: () => null,
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  useProjects: () => [],
  useThreadShells: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../state/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/queries")>()),
  useThreadSearch: (_environments: unknown, query: string) => ({
    query,
    matches: [],
    isPending: false,
  }),
}));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  useEnvironmentScope: () => false,
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: () => ({}),
}));
vi.mock("./settings/useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
}));

async function dismissPalette() {
  await userEvent.keyboard("{Escape}");
  await expect
    .element(page.getByRole("dialog", { name: "Command palette" }))
    .not.toBeInTheDocument();
}

function Composer() {
  const handle = useComposerHandleContext();
  const input = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    handle,
    () =>
      ({
        focusAtEnd: () => {
          input.current?.focus();
          input.current?.setSelectionRange(input.current.value.length, input.current.value.length);
        },
      }) as NonNullable<NonNullable<typeof handle>["current"]>,
  );
  return <textarea ref={input} aria-label="Composer" defaultValue="Draft prompt" />;
}

describe("command palette focus restoration", () => {
  it("returns to the previously focused Settings field when no composer is mounted", async () => {
    await using screen = await render(
      <CommandPalette>
        <input aria-label="Settings field" />
      </CommandPalette>,
      { router: "/settings" },
    );
    const field = screen.getByRole("textbox", { name: "Settings field" });
    await userEvent.click(field);
    await act(() => openCommandPalette());
    await expect.element(page.getByRole("combobox")).toHaveFocus();
    await dismissPalette();
    await expect.element(field).toHaveFocus();
  });

  it("focuses the replacement command input after leaving the file picker", async () => {
    await using screen = await render(
      <CommandPalette>
        <input aria-label="Settings field" />
      </CommandPalette>,
      { router: "/settings" },
    );
    const field = screen.getByRole("textbox", { name: "Settings field" });
    await userEvent.click(field);
    const mac = isMacPlatform(navigator.platform);
    await act(() =>
      field.element().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          ctrlKey: !mac,
          metaKey: mac,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect.element(page.getByRole("dialog", { name: "File picker" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    await expect.element(page.getByRole("combobox")).toHaveFocus();
    await dismissPalette();
    await expect.element(field).toHaveFocus();
  });

  it("focuses the mounted composer at the end instead of the previous field", async () => {
    await using screen = await render(
      <CommandPalette>
        <input aria-label="Previous field" />
        <Composer />
      </CommandPalette>,
      { router: "/settings" },
    );
    await userEvent.click(screen.getByRole("textbox", { name: "Previous field" }));
    await act(() => openCommandPalette());
    await expect.element(page.getByRole("combobox")).toHaveFocus();
    await dismissPalette();
    const composer = screen.getByRole("textbox", { name: "Composer" });
    await expect.element(composer).toHaveFocus();
    const input = composer.element() as HTMLTextAreaElement;
    expect(input.selectionStart).toBe(input.value.length);
  });
});
