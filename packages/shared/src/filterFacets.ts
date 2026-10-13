/**
 * Faceted filtering for list filter menus. Each dimension's choices, and the count beside each,
 * come from the items that pass every *other* applied dimension, so a menu shows what picking a
 * choice would leave rather than what the whole list holds. A picked value the other filters
 * now exclude stays offered with a count of 0, so it can still be unpicked.
 */

export interface FilterDimension<Item> {
  /** The choices one item belongs to in this dimension, such as its labels or its author. */
  readonly values: (item: Item) => ReadonlyArray<string>;
  /** The applied choices. Empty means the dimension is off. */
  readonly selected: ReadonlyArray<string>;
  /**
   * Whether an item passes this dimension's selection. Defaults to belonging to any selected
   * value; pass one for "all of", ranges, or anything else.
   */
  readonly matches?: (item: Item) => boolean;
}

export interface FacetChoice {
  readonly value: string;
  readonly count: number;
}

function passes<Item>(dimension: FilterDimension<Item>, item: Item): boolean {
  if (dimension.matches) return dimension.matches(item);
  if (dimension.selected.length === 0) return true;
  return dimension.values(item).some((value) => dimension.selected.includes(value));
}

/** The items every dimension lets through. */
export function applyFilterDimensions<Item, Key extends string>(
  items: ReadonlyArray<Item>,
  dimensions: Record<Key, FilterDimension<Item>>,
): Item[] {
  const all = Object.values<FilterDimension<Item>>(dimensions);
  return items.filter((item) => all.every((dimension) => passes(dimension, item)));
}

/**
 * Each dimension's choices with how many items picking each would show under the other applied
 * dimensions, most frequent first, then by value. Callers that list choices in a fixed order
 * (date ranges, states) can look counts up by value instead.
 */
export function filterFacets<Item, Key extends string>(
  items: ReadonlyArray<Item>,
  dimensions: Record<Key, FilterDimension<Item>>,
): Record<Key, FacetChoice[]> {
  const keys = Object.keys(dimensions) as Key[];
  const result = {} as Record<Key, FacetChoice[]>;
  for (const key of keys) {
    const dimension = dimensions[key];
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!keys.every((other) => other === key || passes(dimensions[other], item))) continue;
      for (const value of new Set(dimension.values(item))) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    for (const value of dimension.selected) if (!counts.has(value)) counts.set(value, 0);
    result[key] = [...counts]
      .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  }
  return result;
}
