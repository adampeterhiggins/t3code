#!/usr/bin/env python3
"""Composite a transparent capture: compose.py src out height [dark]. Needs Pillow."""

import argparse

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src")
    parser.add_argument("out")
    parser.add_argument("height", type=int, help="Content height in capture pixels (Retina is 2x)")
    parser.add_argument("theme", nargs="?", choices=["dark"])
    args = parser.parse_args()
    with Image.open(args.src) as source:
        if not 0 < args.height <= source.height:
            parser.error("height must be within the source image")
        content = source.convert("RGBA").crop((0, 0, source.width, args.height))
    backdrop = Image.new("RGBA", content.size, "#202124" if args.theme else "#eeeeee")
    Image.alpha_composite(backdrop, content).convert("RGB").save(args.out, format="PNG")


if __name__ == "__main__":
    main()
