import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { addDays, dayFromKey, localDayKey, startOfWeek } from "./googleFilePicker.logic";

/**
 * A week of days to pick from, with the month it falls in and buttons to move a week either way
 * or back to this one. A dot marks days with events; picking the selected day again shows the
 * whole week.
 */
export function GoogleCalendarWeekStrip(props: {
  weekStart: Date;
  selectedDay: string | null;
  today: string;
  /** Events per day in the loaded week, by `localDayKey`. */
  counts: ReadonlyMap<string, number>;
  onSelectDay: (day: string | null) => void;
  onWeekStartChange: (weekStart: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(props.weekStart, index));
  const month = addDays(props.weekStart, 3).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const thisWeek = days.some((day) => localDayKey(day) === props.today);
  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{month}</span>
        {thisWeek && props.selectedDay === props.today ? null : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              props.onWeekStartChange(startOfWeek(dayFromKey(props.today)));
              props.onSelectDay(props.today);
            }}
          >
            Today
          </Button>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Previous week"
          onClick={() => props.onWeekStartChange(addDays(props.weekStart, -7))}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Next week"
          onClick={() => props.onWeekStartChange(addDays(props.weekStart, 7))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const day = localDayKey(date);
          const selected = day === props.selectedDay;
          const count = props.counts.get(day) ?? 0;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${count === 1 ? "1 event" : `${count} events`}`}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-0.5 rounded-md py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                selected && "bg-accent text-accent-foreground",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onSelectDay(selected ? null : day)}
            >
              <span className="text-2xs text-muted-foreground">
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "text-sm tabular-nums",
                  day === props.today && "font-semibold text-primary",
                )}
              >
                {date.getDate()}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-1 rounded-full bg-muted-foreground/60",
                  count === 0 && "invisible",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
