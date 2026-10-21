import type { ScopedThreadRef } from "@t3tools/contracts";

import { DiscordThreadLinkRow, useThreadDiscordLink } from "./DiscordThreadLink";
import { GitHubIssueThreadLinkRow, useThreadGitHubIssueLink } from "./GitHubIssueThreadLink";
import { GranolaThreadLinkRow, useThreadGranolaLink } from "./GranolaThreadLink";
import { LinearThreadLinkRow, useThreadLinearLink } from "./LinearThreadLink";
import { NotionThreadLinkRow, useThreadNotionLink } from "./NotionThreadLink";
import { SlackThreadLinkRow, useThreadSlackLink } from "./SlackThreadLink";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** The issues, conversations, pages, and notes linked to the thread's tab group. */
export function ThreadLinks(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const linear = useThreadLinearLink(threadRef);
  const github = useThreadGitHubIssueLink(threadRef);
  const slack = useThreadSlackLink(threadRef);
  const discord = useThreadDiscordLink(threadRef);
  const notion = useThreadNotionLink(threadRef);
  const granola = useThreadGranolaLink(threadRef);
  if (!linear && !github && !slack && !discord && !notion && !granola) return null;

  return (
    <ThreadDetailsSection headingId="thread-details-links-heading" title="Links">
      <ul className="flex flex-col">
        {linear ? <LinearThreadLinkRow threadRef={threadRef} link={linear} /> : null}
        {github ? <GitHubIssueThreadLinkRow threadRef={threadRef} link={github} /> : null}
        {slack ? <SlackThreadLinkRow threadRef={threadRef} link={slack} /> : null}
        {discord ? <DiscordThreadLinkRow threadRef={threadRef} link={discord} /> : null}
        {notion ? <NotionThreadLinkRow threadRef={threadRef} link={notion} /> : null}
        {granola ? <GranolaThreadLinkRow threadRef={threadRef} link={granola} /> : null}
      </ul>
    </ThreadDetailsSection>
  );
}
