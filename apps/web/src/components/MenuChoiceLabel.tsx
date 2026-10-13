import { HighlightedSearchText } from "./ui/highlighted-search-text";

/** "Only" on the highlighted row: narrow to just that choice. It follows the
 *  label on the same baseline and keeps its width while hidden, so the
 *  trailing count stays in one column on every row. */
function OnlyButton(props: { onClick: () => void }) {
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
      Only
    </button>
  );
}

/** A multi-select filter row's label, with "Only" beside it on hover. */
export function MenuChoiceLabel(props: { label: string; query?: string; onOnly: () => void }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="min-w-0 truncate">
        <HighlightedSearchText text={props.label} query={props.query ?? ""} />
      </span>
      <OnlyButton onClick={props.onOnly} />
    </span>
  );
}
