import { HighlightedSearchText } from "./ui/highlighted-search-text";

export function ThreadSearchMatchExcerpt(props: {
  match: {
    readonly source: "user" | "assistant" | "group_name";
    readonly snippet: string;
    readonly query: string;
  };
}) {
  if (props.match.source === "group_name")
    return (
      <span className="truncate text-xs text-muted-foreground/85">
        <HighlightedSearchText text={props.match.snippet} query={props.match.query} />
      </span>
    );
  const isUser = props.match.source === "user";
  return (
    <span className="truncate text-xs text-muted-foreground/85">
      <span className={isUser ? "text-info-foreground" : "text-success-foreground"}>
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      <HighlightedSearchText text={props.match.snippet} query={props.match.query} />
    </span>
  );
}
