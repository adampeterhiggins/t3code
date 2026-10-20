import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

let root: Root;
let container: HTMLDivElement;
let style: HTMLStyleElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  // The bug needs the popup to stay mounted while it animates out, as the app's CSS does.
  style = document.createElement("style");
  style.textContent =
    "[data-slot=popover-popup]{transition:opacity 150ms}[data-slot=popover-popup][data-ending-style]{opacity:0}";
  document.head.append(style);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <div style={{ padding: 200, display: "flex", gap: 200 }}>
        <input aria-label="Search threads" />
        <Popover>
          <PopoverTrigger openOnHover delay={0} closeDelay={120}>
            Chip
          </PopoverTrigger>
          <PopoverPopup>
            <button type="button">Inside</button>
          </PopoverPopup>
        </Popover>
      </div>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  style.remove();
});

it("leaves focus on a control clicked while a hover-opened popover is open", async () => {
  await userEvent.hover(page.getByRole("button", { name: "Chip" }));
  const inside = page.getByRole("button", { name: "Inside" });
  await userEvent.click(inside);
  await expect.element(inside).toHaveFocus();

  const search = page.getByRole("textbox", { name: "Search threads" });
  await userEvent.click(search);
  await expect.poll(() => document.querySelector("[data-slot=popover-popup]")).toBeNull();
  await expect.element(search).toHaveFocus();
});
