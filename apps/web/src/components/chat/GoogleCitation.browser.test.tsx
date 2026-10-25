import { EnvironmentId, type GoogleFileContext } from "@t3tools/contracts";
import { parseComposerObjectLink } from "@t3tools/source-control-definitions/composerObjectLinks";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const source = vi.hoisted(() => ({ value: null as GoogleFileContext | null }));
vi.mock("~/state/google", () => ({ googleEnvironment: { file: () => "google-source" } }));
vi.mock("~/state/query", async (original) => ({
  ...(await original<typeof import("~/state/query")>()),
  useEnvironmentQuery: (query: unknown) => ({
    data: query === "google-source" ? source.value : null,
    error: null,
  }),
}));
vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<typeof import("~/hooks/useSettings")>()),
  useEnvironmentSettings: (
    _environmentId: unknown,
    select: (settings: Record<string, boolean>) => boolean,
  ) => select({ enableGoogleIntegration: true }),
}));
vi.mock("~/browser/useOpenLink", () => ({
  useLinkClickHandler: () => () => {},
  useOpenLink: () => () => {},
}));

import { LinkedObjectLinkPreview, isPreviewableObjectLink } from "./LinkedObjectLinkPreview";

it("previews the cited spreadsheet cells from a native range link", async () => {
  const url = "https://docs.google.com/spreadsheets/d/budget/edit#gid=42&range=B4:D6";
  source.value = {
    id: "budget",
    title: "Launch budget",
    fileType: "sheet",
    url,
    updatedAt: "2026-10-01T00:00:00.000Z",
    location: "Forecast!B4:D6",
    grid: [
      ["Marketing", "$14,500"],
      ["Total", "$21,700"],
    ],
    markdown: "Selected range",
  };
  const link = parseComposerObjectLink(url);
  if (!isPreviewableObjectLink(link)) throw new Error("Expected a Google source link");
  await using screen = await render(
    <LinkedObjectLinkPreview
      environmentId={EnvironmentId.make("test")}
      threadRef={null}
      objectLink={link}
      link={<a href={url}>Budget · B4:D6</a>}
    />,
  );
  await userEvent.hover(screen.getByRole("link", { name: "Budget · B4:D6" }));
  await expect.element(page.getByText("Launch budget · Forecast!B4:D6")).toBeVisible();
  await expect.element(page.getByRole("cell", { name: "$21,700" })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Open in Google Sheets" }))
    .toHaveAttribute("href", url);
});

it("previews a Calendar citation with the event time and attendees", async () => {
  const url = `https://calendar.google.com/calendar/event?eid=${btoa("review team@example.com")}`;
  source.value = {
    id: url,
    title: "Launch review",
    fileType: "event",
    url,
    updatedAt: "2026-10-25T10:00:00.000Z",
    markdown: "Start: 2026-10-26 10:00 Europe/London\n\nAttendees: priya@example.com",
  };
  const link = parseComposerObjectLink(url);
  if (!isPreviewableObjectLink(link)) throw new Error("Expected a Calendar link");
  await using screen = await render(
    <LinkedObjectLinkPreview
      environmentId={EnvironmentId.make("test")}
      threadRef={null}
      objectLink={link}
      link={<a href={url}>Launch review</a>}
    />,
  );
  await userEvent.hover(screen.getByRole("link", { name: "Launch review" }));
  await expect.element(page.getByText("Start: 2026-10-26 10:00 Europe/London")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Open in Google Calendar" }))
    .toHaveAttribute("href", url);
});
