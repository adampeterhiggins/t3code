import { expect, it } from "vite-plus/test";

import {
  pictureSourceUrl,
  rehypeResolvePictureSources,
  type PictureSource,
} from "./markdownPicture.ts";

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

it("replaces a picture element with the image for that appearance", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        children: [
          {
            type: "element",
            tagName: "picture",
            children: [
              {
                type: "element",
                tagName: "source",
                properties: { media: "(prefers-color-scheme: dark)", srcSet: DARK },
                children: [],
              },
              {
                type: "element",
                tagName: "img",
                properties: { src: LIGHT, alt: "Devin Review" },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
  rehypeResolvePictureSources("dark")()(tree);
  expect(tree.children[0]?.children[0]).toMatchObject({
    tagName: "img",
    properties: { src: DARK, alt: "Devin Review" },
  });
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
