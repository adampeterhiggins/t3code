import { getTranslationsSnapshot, GTProvider, useMessages } from "gt-react";
import { expect, it } from "vite-plus/test";

import { initializeI18n } from "~/i18n/initializeI18n";
import { render } from "../../../test/render";
import { terminalContextDisplayLabel } from "~/lib/terminalContext";
import { TerminalChipTrigger } from "./TerminalContextPreview";

function LocalizedTerminalChip({ lineEnd }: { readonly lineEnd: number }) {
  const resolve = useMessages();
  return (
    <TerminalChipTrigger
      label={terminalContextDisplayLabel(
        { terminalLabel: "ターミナル 2", lineStart: 7, lineEnd },
        resolve,
      )}
      expired={false}
    />
  );
}

it.each([
  { lineEnd: 7, label: "ターミナル 2 7 行目" },
  { lineEnd: 9, label: "ターミナル 2 7–9 行目" },
])("shows the exact Japanese line label $label", async ({ lineEnd, label }) => {
  initializeI18n(() => {});
  const translations = await getTranslationsSnapshot("ja");
  await using screen = await render(
    <GTProvider locale="ja" translations={translations}>
      <LocalizedTerminalChip lineEnd={lineEnd} />
    </GTProvider>,
  );

  await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
});
