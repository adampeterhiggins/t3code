import type { EnvironmentId, PullRequestContextMetadata } from "@t3tools/contracts";
import { CircleDashedIcon, FilmIcon, ImageIcon } from "lucide-react";
import {
  useRef,
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useAssetUrlState } from "~/assets/assetUrls";
import { documentIconColorForFileName } from "~/pierre-icons";

import { PULL_REQUEST_STATE_PRESENTATION } from "~/components/pullRequest/pullRequestIcons";
import type { PullRequestContextDisplayState } from "~/lib/composerContextRecords";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { middleTruncateAttachmentName } from "./composerInlineChip";
import { PullRequestContextDetails } from "./PullRequestContextDetails";
import { ContextChip, ContextChipLabel, type ContextChipKind } from "./ContextChip";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Truncatable } from "./ui/truncatable";
import { PullRequestLinkPreview } from "./pullRequest/PullRequestLinkPreview";
import { usePullRequestPreviewTarget } from "~/lib/openPullRequestLink";

export const PULL_REQUEST_CHIP_KINDS = {
  open: "pr-open",
  draft: "pr-draft",
  merged: "pr-merged",
  closed: "pr-closed",
  unknown: "pull-request",
} as const satisfies Record<PullRequestContextDisplayState | "unknown", ContextChipKind>;

function ContextChipShell({
  icon,
  label,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "className" | "render"> & {
  icon: ReactNode;
  label: string;
  tooltip?: ReactNode;
}) {
  const chip = (
    <ContextChip
      data-context-unresolved={props.state === "unresolved" ? "true" : undefined}
      tabIndex={tooltip ? 0 : undefined}
      {...props}
    >
      {icon}
      <ContextChipLabel>{label}</ContextChipLabel>
    </ContextChip>
  );
  if (!tooltip) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A chip drawn as a button, the trigger most context previews open from. */
export function ContextChipButton({
  icon,
  label,
  copyMarkdown,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "className" | "render" | "children"> & {
  icon: ReactNode;
  label: string;
  copyMarkdown?: string | undefined;
}) {
  return (
    <ContextChip render={<button type="button" />} data-markdown-copy={copyMarkdown} {...props}>
      {icon}
      <ContextChipLabel>
        <Truncatable>{label}</Truncatable>
      </ContextChipLabel>
    </ContextChip>
  );
}

/**
 * A chip that previews its details on hover, matching pull request link previews; a click
 * pins the popover open for keyboard and touch users.
 */
export function ContextChipPopover(props: {
  kind: ContextChipKind;
  state?: "unresolved" | "invalid";
  icon: ReactNode;
  label: string;
  copyMarkdown?: string | undefined;
  accessibleLabel: string;
  onIntent?: () => void;
  stayOpenAfterPress?: boolean;
  children: ReactNode;
}) {
  return (
    <HoverPopover
      trigger={
        <ContextChipButton
          kind={props.kind}
          {...(props.state ? { state: props.state } : {})}
          icon={props.icon}
          label={props.label}
          aria-label={`${props.accessibleLabel}. Show details`}
          copyMarkdown={props.copyMarkdown}
        />
      }
      accessibleLabel={props.accessibleLabel}
      {...(props.onIntent ? { onIntent: props.onIntent } : {})}
      {...(props.stayOpenAfterPress ? { stayOpenAfterPress: true } : {})}
    >
      {props.children}
    </HoverPopover>
  );
}

/** Opens on hover over `trigger`, which should be a button so a click can pin it open. */
export function HoverPopover(props: {
  trigger: ReactElement;
  accessibleLabel: string;
  /** Hover or focus on the trigger, ahead of the open delay: time to start loading the details. */
  onIntent?: (() => void) | undefined;
  /**
   * Once pressed inside, hovering away no longer closes it, so a selection made inside it,
   * which can end with the pointer outside, survives long enough to copy. Closing then hands
   * focus back to wherever it was before the press, such as the composer.
   */
  stayOpenAfterPress?: boolean | undefined;
  side?: "top" | "right" | "bottom" | "left" | undefined;
  align?: "start" | "center" | "end" | undefined;
  sideOffset?: number | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  const pressedInsideRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Popover
      {...(props.disabled ? { open: false } : {})}
      onOpenChange={(open, details) => {
        if (open) return;
        if (pressedInsideRef.current && details.reason === "trigger-hover") {
          details.cancel();
          return;
        }
        pressedInsideRef.current = false;
        if (!popupRef.current?.contains(document.activeElement)) returnFocusRef.current = null;
      }}
      onOpenChangeComplete={(open) => {
        if (open) return;
        // Base UI leaves focus alone when a hover-opened popover closes, so focus that was
        // inside it falls to the body as the popup unmounts. Focus elsewhere was the user's.
        const returnFocus = returnFocusRef.current;
        returnFocusRef.current = null;
        const active = document.activeElement;
        const stranded = active === document.body || popupRef.current?.contains(active);
        if (returnFocus?.isConnected && stranded) {
          returnFocus.focus({ preventScroll: true });
        }
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={350}
        closeDelay={120}
        onPointerEnter={props.onIntent}
        onFocus={props.onIntent}
        render={props.trigger}
      />
      <PopoverPopup
        ref={popupRef}
        side={props.side ?? "top"}
        {...(props.align ? { align: props.align } : {})}
        {...(props.sideOffset !== undefined ? { sideOffset: props.sideOffset } : {})}
        width="lg"
        padding="compact"
        onPointerDownCapture={
          props.stayOpenAfterPress
            ? (event) => {
                pressedInsideRef.current = true;
                const active = document.activeElement;
                if (active instanceof HTMLElement && !event.currentTarget.contains(active)) {
                  returnFocusRef.current = active;
                }
              }
            : undefined
        }
      >
        <PopoverTitle className="sr-only">{props.accessibleLabel}</PopoverTitle>
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}

/** A pull request summary's chip; the review-comment preview supplies its hover. */
export function PullRequestChipTrigger({
  metadata,
  label,
  kindLabel,
  kind,
  copyMarkdown,
  onOpen,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render" | "children" | "onClick"> & {
  metadata: PullRequestContextMetadata;
  label: string;
  kindLabel: string;
  kind: ContextChipKind;
  copyMarkdown?: string | undefined;
  onOpen: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const displayState = metadata.state === "open" && metadata.isDraft ? "draft" : metadata.state;
  const StateIcon = PULL_REQUEST_STATE_PRESENTATION[displayState].Icon;
  return (
    <ContextChip
      kind={kind}
      render={<button type="button" />}
      aria-label={`Open ${kindLabel} ${label}: ${metadata.title}`}
      data-markdown-copy={copyMarkdown}
      onClick={(event) => onOpen(event, metadata.url)}
      onAuxClick={(event) => onOpen(event, metadata.url)}
      {...props}
    >
      <StateIcon />
      <ContextChipLabel>{label}</ContextChipLabel>
    </ContextChip>
  );
}

/**
 * The hover for a pull request summary: the live pull request preview where the environment can
 * read it, else the metadata captured with the chip.
 */
export function PullRequestSummaryHover(props: {
  trigger: ReactElement<ComponentProps<"button">>;
  metadata: PullRequestContextMetadata;
  environmentId: EnvironmentId | null;
}) {
  const previewTarget = usePullRequestPreviewTarget(props.environmentId, props.metadata.url);
  if (previewTarget !== null) {
    return (
      <PullRequestLinkPreview
        link={props.trigger}
        originalUrl={props.metadata.url}
        target={previewTarget}
        confirmBeforeOpen={false}
        fallback={<PullRequestContextDetails metadata={props.metadata} />}
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">
        <PullRequestContextDetails metadata={props.metadata} />
      </TooltipPopup>
    </Tooltip>
  );
}

function averageImageColor(image: HTMLImageElement): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let index = 0; index < data.length; index += 4) {
      const weight = data[index + 3]!;
      red += data[index]! * weight;
      green += data[index + 1]! * weight;
      blue += data[index + 2]! * weight;
      alpha += weight;
    }
    if (alpha === 0) return;
    return `rgb(${Math.round(red / alpha)} ${Math.round(green / alpha)} ${Math.round(blue / alpha)})`;
  } catch {
    return;
  }
}

export function ImageChipButton({
  name,
  previewUrl,
  size,
  suffix,
  disabled,
  onPreviewError,
  style,
  ...props
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render"> & {
  name: string;
  previewUrl: string | undefined;
  size: string;
  suffix?: string | null | undefined;
  disabled?: boolean | undefined;
  onPreviewError?: (() => void) | undefined;
}) {
  const [sample, setSample] = useState<{ url: string; color: string | undefined }>();
  const [corsFailedUrl, setCorsFailedUrl] = useState<string>();
  const accent = sample?.url === previewUrl ? sample?.color : undefined;
  return (
    <ContextChip
      kind="image"
      render={<button type="button" disabled={disabled} />}
      aria-label={`Image attachment, ${name}, ${size}`}
      style={{ ...style, ...(accent ? { "--context-chip-accent": accent } : {}) } as CSSProperties}
      {...props}
    >
      {previewUrl ? (
        <img
          key={previewUrl}
          crossOrigin={corsFailedUrl === previewUrl ? undefined : "anonymous"}
          src={previewUrl}
          alt=""
          className="size-[1.17em] shrink-0 rounded-sm object-cover"
          onError={() => {
            if (corsFailedUrl === previewUrl) onPreviewError?.();
            else setCorsFailedUrl(previewUrl);
          }}
          onLoad={(event) =>
            setSample({ url: previewUrl, color: averageImageColor(event.currentTarget) })
          }
        />
      ) : (
        <ImageIcon />
      )}
      <ContextChipLabel className="flex items-baseline gap-[0.33em]">
        <span className="max-w-72 truncate">{middleTruncateAttachmentName(name)}</span>
        <span className="shrink-0 text-3xs text-current">{size}</span>
        {suffix ? <span className="text-3xs text-current">{suffix}</span> : null}
      </ContextChipLabel>
    </ContextChip>
  );
}

export function FileChip({
  name,
  size,
  isVideo,
  theme,
  accessibleLabel,
  suffix,
  copyMarkdown,
  disabled,
  error,
  unresolved,
  onOpen,
  svgPreview,
  tooltip,
  ...rest
}: Omit<ComponentProps<typeof ContextChip>, "kind" | "render" | "children" | "onClick"> & {
  name: string;
  size: string;
  isVideo: boolean;
  theme: "light" | "dark";
  accessibleLabel: string;
  suffix?: string | null | undefined;
  copyMarkdown?: string | undefined;
  disabled?: boolean | undefined;
  error?: boolean | undefined;
  unresolved?: boolean | undefined;
  onOpen?: (() => void) | undefined;
  tooltip?: ReactNode;
  svgPreview?:
    | {
        file?: Blob | null | undefined;
        environmentId?: EnvironmentId | undefined;
        attachmentId?: string | undefined;
      }
    | undefined;
}) {
  if (svgPreview && !unresolved)
    return (
      <SvgFileChip
        {...{
          name,
          size,
          isVideo,
          theme,
          accessibleLabel,
          suffix,
          copyMarkdown,
          disabled,
          error,
          unresolved,
          onOpen,
          svgPreview,
          tooltip,
          ...rest,
        }}
      />
    );
  const content = <FileChipContent {...{ name, size, isVideo, theme, suffix }} />;
  const accent = isVideo ? undefined : documentIconColorForFileName(name);
  const state = unresolved ? ("unresolved" as const) : error ? ("invalid" as const) : null;
  const attributes = {
    kind: isVideo ? "video" : "file",
    style: accent ? ({ "--context-chip-accent": accent } as CSSProperties) : undefined,
    ...(state ? { state } : {}),
    "aria-label": [accessibleLabel, suffix].filter(Boolean).join(", "),
    "data-markdown-copy": copyMarkdown,
    "data-context-unresolved": unresolved ? "true" : undefined,
    ...rest,
  } as const;
  return onOpen ? (
    <ContextChip
      render={<button type="button" disabled={disabled} />}
      onClick={onOpen}
      {...attributes}
    >
      {content}
    </ContextChip>
  ) : (
    <ContextChip tabIndex={0} {...attributes}>
      {content}
    </ContextChip>
  );
}

/** An image attachment at a size that fits a hover card. */
export function ImageAttachmentPreview(props: { url: string }) {
  return (
    <div className="overflow-hidden rounded-t-lg border-b border-border/70 bg-muted/40">
      <img src={props.url} alt="" className="mx-auto block max-h-64 max-w-full object-contain" />
    </div>
  );
}

function SvgFileChip(props: ComponentProps<typeof FileChip>) {
  const preview = props.svgPreview;
  const [local, setLocal] = useState<{ file: Blob; url: string }>();
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string>();
  const asset = useAssetUrlState(
    preview?.file ? null : (preview?.environmentId ?? null),
    preview?.attachmentId
      ? {
          _tag: "attachment",
          attachmentId: preview.attachmentId,
          fileName: props.name,
          mimeType: "image/svg+xml",
          disposition: "inline",
        }
      : null,
  );
  useEffect(() => {
    const file = preview?.file;
    if (!file) return;
    const url = URL.createObjectURL(file);
    // oxlint-disable-next-line react/set-state-in-effect -- Publish a Blob URL with its cleanup registered.
    setLocal({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [preview?.file]);
  const url = preview?.file
    ? local?.file === preview.file
      ? local.url
      : undefined
    : asset._tag === "Success"
      ? asset.url
      : undefined;
  if (url !== undefined && failedPreviewUrl === url) {
    return <FileChip {...props} svgPreview={undefined} />;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ImageChipButton
            name={props.name}
            size={props.size}
            previewUrl={url}
            suffix={props.suffix}
            disabled={props.disabled}
            onClick={props.onOpen}
            onPreviewError={() => setFailedPreviewUrl(url)}
            data-markdown-copy={props.copyMarkdown}
            aria-label={props.accessibleLabel}
            {...(props.error ? { state: "invalid" as const } : {})}
          />
        }
      />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {props.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

function FileChipContent(props: {
  name: string;
  size: string;
  isVideo: boolean;
  theme: "light" | "dark";
  suffix?: string | null | undefined;
}) {
  return (
    <>
      {props.isVideo ? (
        <FilmIcon />
      ) : (
        <PierreEntryIcon pathValue={props.name} kind="file" theme={props.theme} />
      )}
      <ContextChipLabel className="flex items-baseline gap-[0.33em]">
        <span className="max-w-72 truncate">{middleTruncateAttachmentName(props.name)}</span>
        <span className="shrink-0 text-3xs text-current">{props.size}</span>
        {props.suffix ? <span className="text-3xs text-current">{props.suffix}</span> : null}
      </ContextChipLabel>
    </>
  );
}

export function UnresolvedChip(props: { label: string; tooltip: string; copyMarkdown?: string }) {
  return (
    <ContextChipShell
      icon={<CircleDashedIcon />}
      label={props.label}
      state="unresolved"
      aria-label={`Unavailable context, ${props.label}`}
      data-markdown-copy={props.copyMarkdown}
      tooltip={props.tooltip}
    />
  );
}
