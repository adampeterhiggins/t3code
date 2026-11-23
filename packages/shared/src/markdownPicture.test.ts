import { expect, it } from "vite-plus/test";

import { pictureSourceUrl, type PictureSource } from "./markdownPicture.ts";

const DARK = "https://static.example/badge-dark.svg";
const LIGHT = "https://static.example/badge-light.svg";

const themeBadge: ReadonlyArray<PictureSource> = [
  { media: "(prefers-color-scheme: dark)", srcSet: `${DARK}?v=4` },
  { media: "(prefers-color-scheme: light)", srcSet: `${LIGHT} 1x, ${LIGHT}?v=2 2x` },
];

it("picks the source for the appearance GitHub badges advertise", () => {
  expect(pictureSourceUrl(themeBadge, LIGHT, "dark")).toBe(`${DARK}?v=4`);
  expect(pictureSourceUrl(themeBadge, "https://static.example/fallback.svg", "light")).toBe(LIGHT);
});

it("uses the img fallback when only the other scheme has a source", () => {
  expect(
    pictureSourceUrl([{ media: "(prefers-color-scheme: dark)", srcSet: DARK }], LIGHT, "light"),
  ).toBe(LIGHT);
});

it("ignores an unsafe srcset candidate and a query it cannot read", () => {
  expect(
    pictureSourceUrl(
      [
        {
          media: "(prefers-color-scheme: dark)",
          srcSet: "javascript:alert(1), https://ok.example/a.png",
        },
        { media: "(min-width: 800px)", srcSet: "https://ok.example/wide.png" },
      ],
      LIGHT,
      "dark",
    ),
  ).toBe("https://ok.example/a.png");
  expect(
    pictureSourceUrl(
      [{ media: "screen and (prefers-color-scheme: dark)", srcSet: DARK }],
      LIGHT,
      "dark",
    ),
  ).toBe(LIGHT);
});
