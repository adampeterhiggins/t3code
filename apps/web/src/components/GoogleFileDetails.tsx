import type { GoogleFileContextRecord } from "@t3tools/contracts";
import { T, Var } from "gt-react";
import type { MouseEvent } from "react";
import ChatMarkdown from "./ChatMarkdown";

/** The same source preview is used by citations, pasted links, and attached chips. */
export function GoogleFileDetails({
  record,
  onOpenLink,
}: {
  record: GoogleFileContextRecord;
  onOpenLink: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {record.title}
          {record.location ? ` · ${record.location}` : ""}
        </span>
        <a
          href={record.url}
          onClick={(event) => onOpenLink(event, record.url)}
          className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
        >
          <T>
            Open in <Var>{GOOGLE_APP_NAMES[record.fileType]}</Var>
          </T>
        </a>
      </div>
      {record.grid ? (
        <div className="max-h-80 overflow-auto rounded-lg border border-border/70 bg-background/70">
          <table className="w-full border-collapse text-xs tabular-nums">
            <tbody>
              {record.grid.map((row, r) => (
                // oxlint-disable-next-line react/no-array-index-key -- a fixed snapshot: a cell's position is its identity
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      // oxlint-disable-next-line react/no-array-index-key -- a fixed snapshot: a cell's position is its identity
                      key={c}
                      className={
                        record.location
                          ? "border-b border-r border-border/50 bg-accent/40 px-2 py-1.5"
                          : "border-b border-r border-border/50 px-2 py-1.5"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className={
            record.location
              ? "max-h-80 overflow-y-auto rounded-lg border border-border/70 bg-accent/20 px-3 py-2.5 text-xs"
              : "max-h-80 overflow-y-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs"
          }
        >
          <ChatMarkdown text={record.markdown} cwd={undefined} />
        </div>
      )}
    </div>
  );
}

const GOOGLE_APP_NAMES: Record<GoogleFileContextRecord["fileType"], string> = {
  email: "Gmail",
  event: "Google Calendar",
  sheet: "Google Sheets",
  doc: "Google Docs",
  slides: "Google Slides",
  drive: "Google Drive",
  folder: "Google Drive",
};
