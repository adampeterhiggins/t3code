import { ChevronDownIcon } from "lucide-react";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu";

export interface MenuSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * A compact dropdown that picks one view of a list: the selected label in small caps, an
 * optional count, and a menu of the other options.
 */
export function MenuSelect<T extends string>({
  value,
  options,
  onValueChange,
  count,
  "aria-label": ariaLabel,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<MenuSelectOption<T>>;
  readonly onValueChange: (value: T) => void;
  /** Items in the current view; hidden when zero or omitted. */
  readonly count?: number | undefined;
  readonly "aria-label": string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        }
      >
        {selected?.label}
        {count !== undefined && count > 0 ? (
          <span className="font-mono tracking-normal">· {count}</span>
        ) : null}
        <ChevronDownIcon aria-hidden className="size-3" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            if (option !== undefined) onValueChange(option.value);
          }}
        >
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
