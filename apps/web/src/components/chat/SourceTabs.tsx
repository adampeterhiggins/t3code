import { Button } from "../ui/button";

/**
 * Tabs over a picker list that offers more than one kind of item, such as the `#` menu's pull
 * requests and issues. Clicking one keeps focus where it was, so typing continues the query and
 * arrows still drive the list.
 */
export function SourceTabs<Id extends string>(props: {
  options: ReadonlyArray<{ id: Id; label: string }>;
  activeId: Id;
  onSelect: (id: Id) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={props.className}>
      {props.options.map((tab) => (
        <Button
          key={tab.id}
          type="button"
          role="tab"
          size="xs"
          aria-selected={tab.id === props.activeId}
          variant={tab.id === props.activeId ? "secondary" : "ghost-muted"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onSelect(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
