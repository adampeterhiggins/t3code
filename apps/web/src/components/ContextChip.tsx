import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const contextChipVariants = cva(
  "inline-flex max-w-full items-center gap-[0.2em] font-medium leading-[normal] text-(--context-chip-ink) [--context-chip-ink:var(--context-chip-accent)] [--document-icon-stroke:var(--context-chip-ink)] [&_svg]:block [&_svg]:size-[1em] [&_svg]:shrink-0 [&_svg]:self-center [button&,a&,[data-popup-open]&]:cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current rounded-sm disabled:cursor-default",
  {
    defaultVariants: { kind: "neutral" },
    variants: {
      kind: {
        neutral: "[--context-chip-accent:currentColor]",
        image:
          "rounded-lg border border-(--context-chip-accent)/30 bg-(--context-chip-accent)/10 px-1.5 [--context-chip-accent:var(--context-chip-image)]",
        video: "[--context-chip-accent:oklch(0.62_0.16_48)]",
        file: "[--context-chip-accent:oklch(0.62_0.136_237)]",
        mention: "[--context-chip-accent:oklch(0.62_0.11_215)]",
        terminal: "[--context-chip-accent:oklch(0.62_0.134_163)]",
        element: "[--context-chip-accent:oklch(0.62_0.134_70)]",
        "preview-annotation": "[--context-chip-accent:oklch(0.62_0.134_70)]",
        "review-comment": "[--context-chip-accent:oklch(0.62_0.16_292)]",
        "pull-request": "[--context-chip-accent:oklch(0.62_0.16_277)]",
        "pr-open": "[--context-chip-accent:oklch(0.62_0.134_163)]",
        "pr-draft": "[--context-chip-accent:oklch(0.62_0.02_259)]",
        "pr-merged": "[--context-chip-accent:oklch(0.62_0.16_292)]",
        "pr-closed": "[--context-chip-accent:oklch(0.62_0.16_16)]",
        skill: "[--context-chip-accent:oklch(0.62_0.16_322)]",
        environment: "[--context-chip-accent:var(--context-chip-environment)]",
        "doc-pdf": "[--context-chip-accent:var(--context-chip-doc-pdf)]",
        "doc-word": "[--context-chip-accent:var(--context-chip-doc-word)]",
        "doc-spreadsheet": "[--context-chip-accent:var(--context-chip-doc-spreadsheet)]",
        "doc-slides": "[--context-chip-accent:var(--context-chip-doc-slides)]",
        "doc-epub": "[--context-chip-accent:var(--context-chip-doc-epub)]",
        thread: "[--context-chip-accent:oklch(0.62_0.12_190)]",
        citation: "[--context-chip-accent:oklch(0.62_0.16_259)]",
        "thread-tab": "[--context-chip-accent:oklch(0.62_0.134_120)]",
        "linear-issue": "[--context-chip-accent:oklch(0.62_0.16_270)]",
        "linear-object": "[--context-chip-accent:oklch(0.62_0.16_270)]",
        "github-issue": "[--context-chip-accent:oklch(0.62_0.02_259)]",
        repository: "[--context-chip-accent:oklch(0.62_0.12_195)]",
        checkout: "[--context-chip-accent:oklch(0.62_0.1_200)]",
        "notion-page": "[--context-chip-accent:oklch(0.62_0.02_259)]",
        "google-file":
          "[--context-chip-accent:oklch(0.62_0.15_255)] has-[[data-google-sheet]]:[--context-chip-accent:oklch(0.62_0.13_152)]",
        "granola-note": "[--context-chip-accent:oklch(0.62_0.14_125)]",
        "slack-thread": "[--context-chip-accent:oklch(0.62_0.16_345)]",
        "discord-thread": "[--context-chip-accent:oklch(0.58_0.2_275)]",
        subagent: "[--context-chip-accent:oklch(0.62_0.12_150)]",
        "prompt-link": "[--context-chip-accent:oklch(0.62_0.12_190)]",
        "github-ref": "[--context-chip-accent:oklch(0.62_0.02_259)]",
        model: "[--context-chip-accent:oklch(0.62_0.14_40)]",
        // The accent is the colour itself, set through `style`.
        color: "",
      },
      state: {
        unresolved: "border-dashed",
        loading: "border-dashed",
        invalid: "",
      },
    },
    compoundVariants: [
      {
        kind: [
          "linear-issue",
          "linear-object",
          "github-issue",
          "repository",
          "checkout",
          "notion-page",
          "google-file",
          "granola-note",
          "slack-thread",
          "discord-thread",
          "prompt-link",
          "github-ref",
          "pull-request",
          "pr-open",
          "pr-draft",
          "pr-merged",
          "pr-closed",
        ],
        className: "max-w-[min(24em,100%)]",
      },
      { state: "unresolved", className: "text-foreground" },
      { state: "loading", className: "context-chip-loading bg-transparent text-foreground" },
      { state: "invalid", className: "border-destructive/35 bg-destructive/8 text-destructive" },
    ],
  },
);

type ContextChipKind = NonNullable<VariantProps<typeof contextChipVariants>["kind"]>;

interface ContextChipProps extends useRender.ComponentProps<"span"> {
  kind?: ContextChipKind;
  state?: "unresolved" | "loading" | "invalid";
}

function ContextChip({ className, kind, state, render, ...props }: ContextChipProps) {
  const defaultProps = {
    className: cn(contextChipVariants({ kind, state }), className),
    "data-slot": "context-chip",
    "data-state": state,
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

function ContextChipLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "block min-w-0 self-baseline overflow-x-clip text-ellipsis whitespace-nowrap underline decoration-transparent decoration-1 underline-offset-[0.2em] transition-colors motion-reduce:transition-none [:is(button:enabled,a):hover>&]:decoration-current",
        className,
      )}
      data-slot="context-chip-label"
      {...props}
    />
  );
}

function ContextChipAction({ className, render, ...props }: useRender.ComponentProps<"button">) {
  const defaultProps = {
    className: cn(
      "ml-[0.17em] inline-flex size-[1em] shrink-0 cursor-pointer items-center justify-center rounded-sm text-current transition-colors hover:bg-(--context-chip-accent,var(--color-foreground))/17 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none [&_svg]:size-[0.85em]",
      className,
    ),
    "data-slot": "context-chip-action",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { ContextChip, ContextChipAction, ContextChipLabel, type ContextChipKind };
