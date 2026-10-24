import { INTEGRATION_ICONS, toolActivityBrandMark } from "@t3tools/shared/brandMarks";
import { GlobeIcon } from "lucide-react";
import { Children, Fragment, memo, type ReactNode } from "react";

import type { GitHubRefType } from "@t3tools/contracts";

import { GitHubRefIcon } from "../gitHubRefPresentation";

import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { sourceControlIcon } from "../../sourceControlPresentation";

const MARKDOWN_LINK_FAVICON_CLASS_NAME = "block size-full shrink-0 select-none";

function sourceControlHostIcon(host: string): ReactNode {
  const definition = sourceControlClients.findByPublicDomain(host);
  if (definition === undefined) return null;
  const Icon = sourceControlIcon(definition);
  return <Icon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />;
}

const MarkdownLinkFavicon = memo(function MarkdownLinkFavicon({
  host,
  gitHubRefType,
}: {
  host: string;
  gitHubRefType?: GitHubRefType | null | undefined;
}) {
  const brand = toolActivityBrandMark({ _tag: "website", pageUrl: `https://${host}` });
  const mark = brand ? INTEGRATION_ICONS[brand] : null;
  const brandIcon = sourceControlHostIcon(host);
  return (
    <span
      className="ms-[0.25em] me-[0.2em] inline-flex size-[14px] [vertical-align:-0.125em]"
      aria-hidden
    >
      {gitHubRefType ? (
        <GitHubRefIcon refType={gitHubRefType} className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      ) : mark ? (
        <svg
          viewBox={mark.viewBox}
          fill="currentColor"
          className={MARKDOWN_LINK_FAVICON_CLASS_NAME}
        >
          <path d={mark.path} transform={"transform" in mark ? mark.transform : undefined} />
        </svg>
      ) : brandIcon ? (
        brandIcon
      ) : (
        <GlobeIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      )}
    </span>
  );
});

function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

function breakableExternalLinkText(text: string): ReactNode[] {
  return Array.from(text, (character, index) => (
    <Fragment key={`${index}:${character}`}>
      {character}
      <wbr />
    </Fragment>
  ));
}

export function MarkdownExternalLinkContent({
  host,
  plainText,
  gitHubRefType,
  children,
}: {
  host: string;
  plainText: string | null;
  gitHubRefType?: GitHubRefType | null | undefined;
  children: ReactNode;
}) {
  if (plainText) {
    const leadingLength = leadingExternalLinkTextLength(plainText);
    return (
      <>
        <span className="whitespace-nowrap">
          <MarkdownLinkFavicon host={host} gitHubRefType={gitHubRefType} />
          {plainText.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(plainText.slice(leadingLength))}
      </>
    );
  }

  const childNodes = Children.toArray(children);
  const firstChild = childNodes[0];

  if (typeof firstChild === "string" && firstChild.length > 0) {
    const leadingLength = leadingExternalLinkTextLength(firstChild);
    return (
      <>
        <span className="whitespace-nowrap">
          <MarkdownLinkFavicon host={host} gitHubRefType={gitHubRefType} />
          {firstChild.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(firstChild.slice(leadingLength))}
        {childNodes.slice(1)}
      </>
    );
  }

  return (
    <>
      <span className="whitespace-nowrap">
        <MarkdownLinkFavicon host={host} gitHubRefType={gitHubRefType} />
        {firstChild}
      </span>
      {childNodes.slice(1)}
    </>
  );
}
