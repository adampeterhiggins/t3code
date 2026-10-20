import "~/index.css";

import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("~/state/toolPaths"), async () => {
  const { Atom } = await import("effect/reactivity");
  const roots = Atom.make([]);
  return { toolPathRootsAtom: () => roots };
});

import { ToolPathText } from "./ToolPathText";
import { WorkLogRow } from "./WorkLog";

const environmentId = EnvironmentId.make("environment");

let root: Root;
let host: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  registry.dispose();
  vi.unstubAllGlobals();
});

async function renderRow(text: string, relativePath: string, width: number) {
  host.style.width = `${width}px`;
  await act(async () => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <WorkLogRow
          label={
            <ToolPathText
              text={text}
              targets={[`/repo/${relativePath}`]}
              environmentId={environmentId}
              workspaceRoot="/repo"
              singleLine
            />
          }
        />
      </RegistryContext.Provider>,
    );
  });
}

function verbSpan(text: string) {
  const span = [...host.querySelectorAll("span")].find((element) => element.textContent === text);
  expect(span, text).toBeInstanceOf(HTMLElement);
  return span!;
}

function pathButton(filename: string) {
  const button = [...host.querySelectorAll("button")].find((element) =>
    element.textContent?.endsWith(`/${filename}`),
  );
  expect(button, filename).toBeInstanceOf(HTMLButtonElement);
  return button!;
}

/** Width of one slice of a label's own text, so a collapsed space measures as zero. */
function sliceWidth(element: HTMLElement, start: number, end: number) {
  const node = element.firstChild;
  expect(node).toBeInstanceOf(Text);
  const range = document.createRange();
  range.setStart(node!, start);
  range.setEnd(node!, end);
  return range.getBoundingClientRect().width;
}

describe("single-line tool paths", () => {
  it("keeps a space between the verb and the file, and before a trailing count", async () => {
    const relativePath = "src/index.css";
    await renderRow(`Read repo/${relativePath} +1 more`, relativePath, 640);

    const verb = verbSpan("Read ");
    const suffix = verbSpan(" +1 more");
    expect(sliceWidth(verb, 4, 5)).toBeGreaterThan(2);
    expect(sliceWidth(suffix, 0, 1)).toBeGreaterThan(2);
    expect(pathButton("index.css").textContent).toBe(`repo/${relativePath}`);
  });

  it("keeps a long directory on one line and leaves the file name in view", async () => {
    const relativePath = "apps/web/src/components/chat/MessagesTimeline.tsx";
    await renderRow(`Read repo/${relativePath}`, relativePath, 280);

    const row = host.firstElementChild;
    expect(row).toBeInstanceOf(HTMLElement);
    expect(row!.getBoundingClientRect().height).toBeLessThan(40);

    const button = pathButton("MessagesTimeline.tsx");
    const filename = [...button.querySelectorAll("span")].find(
      (element) => element.textContent === "/MessagesTimeline.tsx",
    );
    expect(filename).toBeInstanceOf(HTMLElement);
    const fileBox = filename!.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    expect(fileBox.width).toBeGreaterThan(0);
    expect(fileBox.left).toBeGreaterThanOrEqual(hostBox.left - 1);
    expect(fileBox.right).toBeLessThanOrEqual(hostBox.right + 1);

    const directory = [...button.querySelectorAll("span")].find((element) =>
      element.textContent?.includes("apps/web"),
    );
    expect(directory).toBeInstanceOf(HTMLElement);
    expect(directory!.scrollWidth).toBeGreaterThan(directory!.clientWidth);
    expect(sliceWidth(verbSpan("Read "), 4, 5)).toBeGreaterThan(2);
  });
});
