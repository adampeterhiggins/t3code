import type { CSSProperties } from "react";

import { describeColorCode } from "~/lib/colorCodes";
import { cn } from "~/lib/utils";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { HoverPopover } from "../contextChipParts";
import { MessageCopyButton } from "./MessageCopyButton";

function ColorSwatch({ code, className }: { code: string; className: string }) {
  return (
    <span
      aria-hidden
      className={cn("color-code-swatch block shrink-0", className)}
      style={{ "--swatch-color": code } as CSSProperties}
    />
  );
}

/** A colour code in chat text, tinted by the colour, with a swatch on hover. */
export function ColorCodeChip({ code }: { code: string }) {
  return (
    <HoverPopover
      accessibleLabel={`Colour ${code}`}
      trigger={
        <ContextChip
          kind="color"
          render={<button type="button" />}
          aria-label={`Colour ${code}. Show swatch`}
          data-markdown-copy={code}
          style={{ "--context-chip-accent": code } as CSSProperties}
        >
          <ColorSwatch code={code} className="size-[1.17em] rounded-sm" />
          <ContextChipLabel className="font-mono tracking-tight">{code}</ContextChipLabel>
        </ContextChip>
      }
    >
      <ColorCodePreview code={code} />
    </HoverPopover>
  );
}

export function ColorCodePreview({ code }: { code: string }) {
  const facts = describeColorCode(code);
  const values = [
    ["HEX", code.toUpperCase()],
    ["RGB", facts.rgb],
    ["HSL", facts.hsl],
  ] as const;
  return (
    <div className="w-72 max-w-full">
      <div
        className="color-code-swatch flex h-28 items-end justify-between gap-2 rounded-md p-2.5 text-xs font-medium"
        style={
          {
            "--swatch-color": code,
            color: facts.prefersDarkText ? "black" : "white",
          } as CSSProperties
        }
      >
        <span>Aa</span>
        <span className="opacity-70">
          {facts.contrastOnWhite}:1 on white · {facts.contrastOnBlack}:1 on black
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 text-xs">
        {values.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">{value}</dd>
            <MessageCopyButton text={value} label={`Copy ${label}`} variant="ghost" />
          </div>
        ))}
      </dl>
    </div>
  );
}
