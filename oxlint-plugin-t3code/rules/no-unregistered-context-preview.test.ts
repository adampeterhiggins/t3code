import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-unregistered-context-preview", {
  filename: "fixture.tsx",
});

describe("t3code/no-unregistered-context-preview", () => {
  rule.valid(
    "allows the registry's own exports",
    `import { ContextPreviewHover } from "./contextPresentationRegistry";`,
  );

  rule.valid(
    "allows non-component helpers from a preview module",
    `import { skillPreviewDescription } from "../contextPreviews";`,
  );

  rule.valid(
    "allows type imports from a preview module",
    `import type { SubagentChipRecord } from "../contextPreviews";
import { type ThreadPreviewProps } from "~/components/ThreadHoverCard";`,
  );

  rule.valid(
    "allows other exports of a partly restricted module",
    `import { useProviderEntries } from "./chat/AgentFleetRow";`,
  );

  rule.invalid(
    "reports a preview body imported from a preview module",
    `import { ThreadPreview } from "./ThreadHoverCard";`,
    (output) => {
      assert.match(output, /ThreadPreview is a hover preview body/);
    },
  );

  rule.invalid(
    "reports a preview popup imported through an alias path",
    `import { ThreadHoverCardPopup } from "~/components/ThreadHoverCard";`,
  );

  rule.invalid(
    "reports a named preview body from a partly restricted module",
    `import { AgentPreviewContent } from "./AgentFleetRow";`,
    (output) => {
      assert.match(output, /ContextPreviewHover or ContextPreviewBody/);
    },
  );
});
