import { HighlightedSearchText } from "./ui/highlighted-search-text";

/** A hover action on the highlighted row, such as "Only". It follows the label on the same
 *  baseline and keeps its width while hidden, so the trailing count stays in one column on
 *  every row. */
function ChoiceActionButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="invisible shrink-0 cursor-pointer text-xs font-medium text-primary in-data-highlighted:visible hover:text-primary/80"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}

/** A multi-select filter row's label, with "Only" (and "Exclude" where offered) beside it on
 *  hover. An excluded choice is struck through. */
export function MenuChoiceLabel(props: {
  label: string;
  query?: string;
  onOnly: () => void;
  onExclude?: (() => void) | undefined;
  excluded?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span
        className={
          props.excluded
            ? "min-w-0 truncate text-muted-foreground line-through"
            : "min-w-0 truncate"
        }
      >
        <HighlightedSearchText text={props.label} query={props.query ?? ""} />
      </span>
      <ChoiceActionButton label="Only" onClick={props.onOnly} />
      {props.onExclude ? <ChoiceActionButton label="Exclude" onClick={props.onExclude} /> : null}
    </span>
  );
}
