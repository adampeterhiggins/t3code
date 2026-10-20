# PR evidence

Capture with the hook's `/capture` route, then inspect the PNG before publishing.
Crop to the window under test. Seeded thread titles, PR titles, project names,
and file paths are real data: exclude private content. Call out in the report
if any published image shows real project names.

Transparent windows need a neutral backdrop. With Pillow available, use:

```bash
python3 .agents/skills/test-t3-desktop/scripts/compose.py \
  /tmp/panel.png /tmp/panel-light.png 800
python3 .agents/skills/test-t3-desktop/scripts/compose.py \
  /tmp/panel.png /tmp/panel-dark.png 800 dark
```

The height is the top-aligned content crop in **image pixels**; Retina captures
are normally 2x (400 logical pixels → 800 image pixels). Crop further beforehand
if private content appears anywhere within that rectangle. The helper composites
alpha onto a neutral light/dark background; it does not redact sensitive text.

When the task authorizes PR evidence upload, publish to a prerelease on the fork;
never commit PR-only images:

```bash
gh release create pr-<topic>-evidence -R adampeterhiggins/t3code \
  --prerelease --title "PR <topic> evidence" --notes "Desktop verification captures." \
  /tmp/panel-light.png /tmp/panel-dark.png
# Add or replace images on that same release:
gh release upload pr-<topic>-evidence -R adampeterhiggins/t3code \
  --clobber /tmp/panel-light.png
```

Embed `https://github.com/adampeterhiggins/t3code/releases/download/<tag>/<file>`
in the PR body. Restore theme, hide test windows, and include what was verified
and any gaps in the report.
