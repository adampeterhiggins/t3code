import "../../index.css";

import { render } from "../../../test/render";
import { InfoIcon } from "lucide-react";
import { render as renderScreen } from "../../../test/render";
import { RunId } from "@t3tools/contracts";
import { act } from "../../../test/render";

import { page, userEvent } from "vite-plus/test/browser";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { Button, InlineButton } from "../ui/button";

import { ComposerBanner } from "./ComposerBanner";

import { usageLimitRecoveryBannerItem } from "./UsageLimitRecoveryBanner";

async function setup() {
  // The banner has no routing behavior.
  const screen = await renderScreen(null, { router: false });
  const container = screen.container;
  const hasDetails = () => container.querySelector('[aria-label="Show notice details"]') !== null;
  const render = async (width: number, description: string) => {
    container.style.width = `${width}px`;
    await screen.rerender(
      <ComposerBannerStack
        items={[{ id: "usage", variant: "info", icon: null, title: "Usage limits", description }]}
      />,
    );
  };
  return {
    screen,
    container,
    render,
    hasDetails,
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

it("only offers notice details when the description cannot fit", async () => {
  await using fixture = await setup();
  const { container, render, hasDetails } = fixture;
  await render(700, "OpenCode");
  await vi.waitFor(() => expect(hasDetails()).toBe(false));

  await render(700, "OpenCode ".repeat(40));
  await vi.waitFor(() => expect(hasDetails()).toBe(true));

  container.style.width = "4000px";

  await vi.waitFor(() => expect(hasDetails()).toBe(false));

  await render(4000, "OpenCode");
  await vi.waitFor(() => expect(hasDetails()).toBe(false));

  // A narrow composer hides the description entirely, so details are the only way to read it.
  container.style.width = "300px";

  await vi.waitFor(() => expect(hasDetails()).toBe(true));
  const details = container.querySelector<HTMLElement>('[aria-label="Show notice details"]')!;
  const detailsBounds = details.getBoundingClientRect();
  const bannerBounds = container
    .querySelector('[data-slot="composer-banner"]')!
    .getBoundingClientRect();
  expect(detailsBounds.width).toBeGreaterThan(0);
  expect(detailsBounds.height).toBeGreaterThan(0);
  expect(detailsBounds.top).toBeGreaterThanOrEqual(bannerBounds.top - 1);
  expect(detailsBounds.bottom).toBeLessThanOrEqual(bannerBounds.bottom + 1);
});

it("does not flash a wrapped action row when the details button appears", async () => {
  await using fixture = await setup();
  const { screen, container, hasDetails } = fixture;
  const description = "Resumes automatically about a minute after 10/20/2026, 11:30:00 PM";
  const actions = (
    <>
      <Button size="xs" variant="ghost">
        Resume now
      </Button>
      <Button size="xs" variant="ghost">
        Cancel auto-resume
      </Button>
      <Button size="xs" variant="ghost">
        Snooze until reset
      </Button>
      <Button size="xs" variant="ghost">
        Continue in new tab
      </Button>
    </>
  );

  for (let width = 480; width <= 1100; width += 20) {
    container.style.width = `${width}px`;
    await act(async () =>
      screen.rerender(
        <ComposerBannerStack
          items={[
            {
              id: "usage-limit",
              variant: "warning",
              icon: null,
              title: "Usage limit reached",
              description,
              actions,
            },
          ]}
        />,
      ),
    );

    const sample = () => {
      const banner = container.querySelector<HTMLElement>('[data-slot="composer-banner"]')!;
      return {
        height: banner.getBoundingClientRect().height,
        details: hasDetails(),
      };
    };

    const first = sample();
    for (let frame = 0; frame < 8; frame += 1) {
      expect(sample(), `width ${width}px`).toEqual(first);
    }
  }
});

it("keeps the usage-limit reset time on the details hover", async () => {
  await using fixture = await setup();
  const { screen, container } = fixture;
  await page.viewport(760, 800);
  container.style.width = "720px";
  const runId = RunId.make("run");
  const resetAt = "2026-10-20T22:30:00.000Z";
  await act(async () =>
    screen.rerender(
      <ComposerBannerStack
        items={[
          usageLimitRecoveryBannerItem({
            runId,
            resetAt,
            stoppedAt: "2026-10-20T21:00:00.000Z",
            snoozedUntil: null,
            recovery: { runId, resetAt, autoResume: true },
            onChange: async () => {},
            timestampFormat: "locale",
            onResumeNow: async () => {},
            continueElsewhere: null,
          }),
        ]}
      />,
    ),
  );

  const banner = container.querySelector<HTMLElement>('[data-slot="composer-banner"]')!;
  const title = page.getByText("Usage limit reached", { exact: true });
  const resume = page.getByRole("button", { name: "Resume now", exact: true });
  const details = page.getByRole("button", { name: "Show notice details", exact: true });
  await expect.element(details).toBeVisible();
  await expect
    .element(page.getByText(/Resumes automatically about a minute after/))
    .not.toBeInTheDocument();
  expect(resume.element().getBoundingClientRect().top).toBe(
    title.element().getBoundingClientRect().top,
  );
  expect(details.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
    title.element().getBoundingClientRect().top - 1,
  );
  expect(details.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    title.element().getBoundingClientRect().bottom + 1,
  );

  const height = banner.getBoundingClientRect().height;
  for (let frame = 0; frame < 6; frame += 1) {
    expect(banner.getBoundingClientRect().height).toBe(height);
  }

  const titleWidth = title.element().getBoundingClientRect().width;
  await userEvent.hover(details);
  const popup = page.getByRole("dialog", { name: "Notice details", exact: true });
  await expect.element(popup).toBeVisible();
  expect(popup.element().textContent ?? "").toContain("Resumes automatically about a minute after");
  const sentence = popup
    .element()
    .querySelector<HTMLElement>("[data-slot=scroll-area-viewport] > div > :last-child");
  expect(sentence).not.toBeNull();
  const lineHeight = Number.parseFloat(getComputedStyle(sentence!).lineHeight);
  expect(sentence!.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 2 + 1);
  expect(sentence!.getBoundingClientRect().width).toBeGreaterThan(titleWidth);
});

it("offers one details button when the usage-limit title is clipped", async () => {
  await using fixture = await setup();
  const { screen, container } = fixture;
  await page.viewport(400, 800);
  container.style.width = "360px";
  const runId = RunId.make("run");
  const resetAt = "2026-10-20T22:30:00.000Z";
  await act(async () =>
    screen.rerender(
      <ComposerBannerStack
        items={[
          usageLimitRecoveryBannerItem({
            runId,
            resetAt,
            stoppedAt: "2026-10-20T21:00:00.000Z",
            snoozedUntil: null,
            recovery: null,
            onChange: async () => {},
            timestampFormat: "locale",
            onResumeNow: async () => {},
            continueElsewhere: null,
          }),
        ]}
      />,
    ),
  );

  const title = container.querySelector<HTMLElement>(".truncate.font-medium")!;
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  expect(container.querySelectorAll('[aria-label$="details"]')).toHaveLength(1);

  await userEvent.hover(page.getByRole("button", { name: "Show notice details", exact: true }));
  const popup = page.getByRole("dialog", { name: "Notice details", exact: true });
  await expect.element(popup).toBeVisible();
  expect(popup.element().textContent).toMatch(/^Usage limit reachedResets /);
});

it.each([320, 800])(
  "keeps long background-work links reachable beside Stop in a %ipx composer",
  async (width) => {
    await using fixture = await setup();
    const { screen, container } = fixture;
    await page.viewport(width + 32, 800);
    container.style.width = `${width}px`;
    const openThread = vi.fn();
    const label = "Review the background task layout and child-thread navigation ".repeat(6);
    await act(async () =>
      screen.rerender(
        <ComposerBannerStack
          items={[
            {
              id: "background-work",
              variant: "default",
              icon: null,
              title: "12 background tasks",
              descriptionPlacement: "below",
              description: Array.from({ length: 12 }, (_, index) => (
                <span key={index}>
                  {index > 0 ? " " : null}
                  <InlineButton
                    tone="muted"
                    aria-label={`Open subagent ${index + 1}`}
                    onClick={() => openThread(index + 1)}
                  >
                    {label}
                  </InlineButton>
                  {index < 11 ? "," : null}
                </span>
              )),
              actions: (
                <Button size="xs" variant="ghost">
                  Stop
                </Button>
              ),
            },
          ]}
        />,
      ),
    );

    const firstLink = page.getByRole("button", { name: "Open subagent 1", exact: true });
    const lastLink = page.getByRole("button", { name: "Open subagent 12", exact: true });
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    expect(firstLink.element().getBoundingClientRect().height).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(firstLink.element()).lineHeight) * 2,
    );
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    expect(viewport).not.toBeNull();
    expect(viewport.clientHeight).toBeGreaterThan(0);
    expect(viewport.clientHeight).toBeLessThanOrEqual(window.innerHeight / 2);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

    const scrollBounds = viewport.getBoundingClientRect();
    const stopBounds = stop.element().getBoundingClientRect();
    expect(stopBounds.top).toBe(
      page.getByText("12 background tasks", { exact: true }).element().getBoundingClientRect().top,
    );
    expect(scrollBounds.right).toBeLessThanOrEqual(stopBounds.left);
    expect(stopBounds.right).toBeLessThanOrEqual(container.getBoundingClientRect().right);
    expect(stopBounds.bottom).toBeLessThanOrEqual(scrollBounds.bottom);
    expect(lastLink.element().getBoundingClientRect().top).toBeGreaterThan(scrollBounds.bottom);
    await firstLink.click();
    expect(openThread).toHaveBeenLastCalledWith(1);

    viewport.scrollTop = viewport.scrollHeight;

    expect(viewport.scrollTop).toBeGreaterThan(0);
    const lastBounds = lastLink.element().getBoundingClientRect();
    expect(lastBounds.top).toBeGreaterThanOrEqual(scrollBounds.top);
    expect(lastBounds.bottom).toBeLessThanOrEqual(scrollBounds.bottom + 1);
    expect(stop.element().getBoundingClientRect().top).toBe(stopBounds.top);
    for (const control of [lastLink.element(), stop.element()]) {
      const bounds = control.getBoundingClientRect();
      expect(
        control.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        ),
      ).toBe(true);
    }
    await lastLink.click();
    expect(openThread).toHaveBeenLastCalledWith(12);
  },
);
import {
  ComposerBannerStack,
  NoticeText,
  type ComposerBannerStackItem,
} from "./ComposerBannerStack";

function notice(title: string, group?: ComposerBannerStackItem["group"]): ComposerBannerStackItem {
  return { id: title, variant: "default", icon: <InfoIcon />, title, ...(group ? { group } : {}) };
}

it("puts machine notices first, whatever order the notices arrive in", async () => {
  await using screen = await renderScreen(
    <ComposerBannerStack items={[notice("Branch changed"), notice("Offline", "environment")]} />,
  );

  expect(screen.container.textContent).toBe("OfflineBranch changed");
});

it("leaves the next attachment its own top edge when there are no notices", async () => {
  await using screen = await renderScreen(
    <ComposerBanner.Column>
      <ComposerBannerStack items={[]} />
      <ComposerBanner.Attachment>
        <ComposerBanner.Root data-testid="drawer">Approval</ComposerBanner.Root>
      </ComposerBanner.Attachment>
    </ComposerBanner.Column>,
  );

  const surface = getComputedStyle(screen.getByTestId("drawer").element(), "::before");
  expect(surface.borderTopWidth).toBe("1px");
  expect(surface.borderTopLeftRadius).not.toBe("0px");
});

function noticeRow(width: string, children: ReactNode) {
  return (
    <div data-testid="row" className="flex items-center gap-1.5" style={{ width }}>
      <NoticeText detailsLabel="Show details" className="min-w-0 truncate">
        {children}
      </NoticeText>
    </div>
  );
}

it("leaves out the details button when only a link's hit area reaches past the text", async () => {
  // Phones lay out in device pixels, so a range can measure one float32 step (2^-17 px at
  // this size) wider than its element. Headless Chromium's rects agree exactly.
  const rangeRect = Range.prototype.getBoundingClientRect;
  using _rangeRect = vi
    .spyOn(Range.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Range) {
      const rect = rangeRect.call(this);
      return new DOMRect(rect.x, rect.y, rect.width + 2 ** -17, rect.height);
    });
  // The flicker is a details button that mounts and then unmounts, so record every insertion.
  const inserted: Node[] = [];
  using observing = new DisposableStack();
  const mutations = new MutationObserver((records) =>
    inserted.push(...records.flatMap((record) => [...record.addedNodes])),
  );
  mutations.observe(document.body, { childList: true, subtree: true });
  observing.defer(() => mutations.disconnect());
  await using screen = await render(
    noticeRow(
      "20rem",
      <>
        Needs input{" "}
        <button type="button" className="relative after:absolute after:-inset-x-10 after:inset-y-0">
          Review
        </button>
      </>,
    ),
  );

  await expect.element(screen.getByText("Review")).toBeVisible();
  const details = [
    ...inserted,
    ...mutations.takeRecords().flatMap((record) => [...record.addedNodes]),
  ].filter(
    (node) =>
      node instanceof Element &&
      (node.matches('[aria-label="Show details"]') ||
        node.querySelector('[aria-label="Show details"]')),
  );
  expect(details).toEqual([]);
});

it("shows the details button while text or nested text is cut, until it fits again", async () => {
  await using screen = await render(noticeRow("4rem", "Waiting on a subagent with a long name"));
  const details = screen.getByRole("button", { name: "Show details" });
  await expect.element(details).toBeInTheDocument();

  await screen.rerender(noticeRow("4rem", "Ready"));
  await expect.element(details).not.toBeInTheDocument();

  await screen.rerender(noticeRow("4rem", "Waiting on a subagent with a long name"));
  await expect.element(details).toBeInTheDocument();

  screen.getByTestId("row").element().style.width = "40rem";
  await expect.element(details).not.toBeInTheDocument();

  await screen.rerender(
    noticeRow(
      "40rem",
      <span className="inline-block max-w-16 truncate align-bottom">A long nested name</span>,
    ),
  );
  await expect.element(details).toBeInTheDocument();

  await screen.rerender(
    <ComposerBanner.Root>
      {noticeRow("4rem", "Waiting on a subagent with a long name")}
    </ComposerBanner.Root>,
  );
  await expect.element(details).toBeInTheDocument();
  await screen.rerender(<ComposerBanner.Root>{noticeRow("4rem", "Ready")}</ComposerBanner.Root>);
  await expect.element(details).not.toBeInTheDocument();
});
