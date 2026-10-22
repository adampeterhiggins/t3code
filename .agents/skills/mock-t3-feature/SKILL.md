---
name: mock-t3-feature
description: Render an HTML mock, mockup, or gallery of a proposed T3 Code UI change from the web app's real components and stylesheet, so it looks the way the feature would ship. Use whenever asked to mock, sketch, or show "what it would look like" before building UI, then publish it with html_render.
---

# Mock a T3 Code feature

A mock is built from the app's real components, never from CSS written to look
like them. A look-alike drifts from the product in spacing, type, radii, and
colour, and the maintainer has to ask again.

## Find the real surface

Read the component the feature lives in and what surrounds it, such as the
settings section it sits in. The mock shows the feature in that context, with
its neighbours, and reuses the same components and classes the real code uses.

## Write the mock

Write a `.tsx` file outside the worktree, for example
`$TMPDIR/t3-mocks/<feature>.tsx`. It default-exports a component and imports
app code through `~/`:

```tsx
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { SettingsSection } from "~/components/settings/settingsLayout";

export default function Mock() {
  const [sorted, setSorted] = useState(false);
  return (
    <div className="flex flex-col gap-6 p-4">
      <SettingsSection title="Managed worktrees">…</SettingsSection>
    </div>
  );
}
```

- Use `components/ui` and the feature's presentational components with made-up
  props. A component that reads server state, atoms, or the router has no data
  here, so render its children with props instead, or copy its JSX.
- Show several variants or states in one mock, stacked and labelled.
- State, menus, popovers, and tooltips work; the page runs real React.
- Do not use viewport-height sizes (`h-screen`, `min-h-svh`, `vh`). The frame
  grows to fit the page, so give fixed heights instead.

## Build and publish

```bash
vp run render-mock /abs/path/to/mock.tsx
```

It writes `<mock>.js`, `<mock>.css`, and `<mock>.html` next to the mock and
prints the page, a few lines that link the bundle by absolute path. Pass that
page as-is to `html_preview`, check both `dark` and `light`, then publish it
with `html_render`. The tools inline the bundle. Rebuild after every edit.

The mock follows the reader's light or dark mode, in T3 Code's default palette.
The script runs on the machine that hosts the T3 server, since the tools read
the bundle from there.

Mobile-only surfaces are React Native and cannot be built this way. Say so, and
mock the web surface if it has one.
