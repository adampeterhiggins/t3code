import { cn } from "~/lib/utils";
import { InfoIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";
import { observeResize } from "~/lib/observeResize";

/**
 * Where a notice sits above the composer. The machine comes first, then what needs you; the
 * order is fixed so rows never trade places as notices come and go.
 */
export type ComposerBannerGroup = "environment" | "attention";

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: ComposerBannerVariant;
  readonly group?: ComposerBannerGroup;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly descriptionPlacement?: "inline" | "below" | "details";
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

const GROUPS = ["environment", "attention"] as const;

/**
 * Notices about sending from this composer, each its own attached card. Consecutive cards join
 * edge to edge, and the last joins the composer or the drawer below it.
 */
export function ComposerBannerStack({
  items,
}: {
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}) {
  return GROUPS.flatMap((group) =>
    items.filter((item) => (item.group ?? "attention") === group),
  ).map((item) => (
    <ComposerBanner.Attachment
      key={item.id}
      data-composer-banner-stack="true"
      className="transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none"
    >
      <NoticeCard item={item} />
    </ComposerBanner.Attachment>
  ));
}

function NoticeDetails({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<Button size="icon-xs" variant="ghost-muted" aria-label={label} />}
      >
        <InfoIcon />
      </PopoverTrigger>
      <PopoverPopup
        aria-label="Notice details"
        tooltipStyle
        side="top"
        className="max-w-[min(30rem,calc(100vw-2rem))] whitespace-normal wrap-anywhere [--inline-button-text-align:start] [--inline-button-white-space:normal] [&_[data-slot=inline-button]]:max-w-full"
      >
        <ComposerBanner.Scroll className="max-h-[min(var(--available-height),24rem,40dvh)]">
          {children}
        </ComposerBanner.Scroll>
      </PopoverPopup>
    </Popover>
  );
}

export function NoticeText({
  children,
  className,
  detailsLabel,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly detailsLabel: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const measure = () => {
      const style = getComputedStyle(text);
      // A narrow composer pulls the description out of the line entirely.
      const hidden = style.position === "absolute";
      // Padding holds the out-of-flow details button. It is inside the text, so
      // subtract it or the button would count as overflow and never leave.
      const reserved = Number.parseFloat(style.paddingInlineEnd) || 0;
      setShowDetails(
        hidden ||
          [text, ...text.querySelectorAll("*")].some(
            (element) =>
              element.scrollWidth > element.clientWidth + (element === text ? reserved : 0),
          ),
      );
    };
    measure();
    const stopObserving = observeResize(text, measure);
    const mutations = new MutationObserver(measure);
    mutations.observe(text, { childList: true, subtree: true, characterData: true });
    return () => {
      stopObserving();
      mutations.disconnect();
    };
  }, []);

  return (
    // The details button has to stay out of flow. In the wrap-actions row it
    // otherwise consumes the last few pixels, the actions drop to the next
    // line, the text then fits, and the button removes itself — so the banner
    // flashes between one line and two.
    <span className={cn("relative block min-w-0", className)}>
      <span
        ref={textRef}
        data-notice-text=""
        className={cn("block max-w-full min-w-0 truncate", showDetails && "pe-7 sm:pe-6")}
      >
        {children}
      </span>
      {showDetails ? (
        <span className="absolute end-0 top-1/2 z-10 -translate-y-1/2">
          <NoticeDetails label={detailsLabel}>{children}</NoticeDetails>
        </span>
      ) : null}
    </span>
  );
}

function NoticeCard({ item }: { readonly item: ComposerBannerStackItem }) {
  const descriptionBelow = item.descriptionPlacement === "below";
  const descriptionDetails = item.descriptionPlacement === "details";
  return (
    <ComposerBanner.Root
      role={item.variant === "error" || item.variant === "warning" ? "alert" : undefined}
      variant={item.variant}
      density="comfortable"
      data-chat-composer-collapsed-controls="true"
    >
      <ComposerBanner.Row layout="wrap-actions">
        <ComposerBanner.Icon className="h-(--composer-banner-icon-column) self-start">
          {item.icon}
        </ComposerBanner.Icon>
        <ComposerBanner.Content
          className={descriptionBelow ? "flex-col items-stretch gap-0" : "whitespace-nowrap"}
        >
          {descriptionDetails && item.description ? (
            <span className="min-w-0 truncate font-medium leading-7 sm:leading-6">
              {item.title}
            </span>
          ) : (
            <NoticeText
              detailsLabel="Show title details"
              className="min-w-0 truncate font-medium leading-7 sm:leading-6"
            >
              {item.title}
            </NoticeText>
          )}
          {descriptionDetails && item.description ? (
            <NoticeDetails label="Show notice details">
              {item.title}
              <div>{item.description}</div>
            </NoticeDetails>
          ) : item.description ? (
            <NoticeText
              detailsLabel="Show notice details"
              className={
                descriptionBelow
                  ? "min-w-0 text-muted-foreground"
                  : "w-0 min-w-0 grow truncate text-muted-foreground @max-[400px]:sr-only"
              }
            >
              {item.description}
            </NoticeText>
          ) : null}
        </ComposerBanner.Content>
        {item.actions || item.onDismiss ? (
          <ComposerBanner.Actions>
            {item.actions}
            {item.onDismiss ? (
              <ComposerBanner.Dismiss
                aria-label={item.dismissLabel ?? "Dismiss warning"}
                onClick={item.onDismiss}
              />
            ) : null}
          </ComposerBanner.Actions>
        ) : null}
      </ComposerBanner.Row>
      {item.children ? <ComposerBanner.Children>{item.children}</ComposerBanner.Children> : null}
    </ComposerBanner.Root>
  );
}
