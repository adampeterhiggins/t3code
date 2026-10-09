import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";

const MAX_STRING_PREVIEW = 400;

/** Parses tool output that is a JSON object or array; null for anything else. */
export function parseJsonDocument(text: string): object | null {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

// Encoded IDs and URLs carry no spaces; their ends tell them apart.
const MAX_TOKEN_PREVIEW = 48;

function JsonString({ value }: { readonly value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded || value.length <= MAX_TOKEN_PREVIEW) {
    return <span className="text-success-foreground">{JSON.stringify(value)}</span>;
  }
  if (!/\s/.test(value)) {
    return (
      <button
        type="button"
        className="text-left text-success-foreground hover:underline"
        onClick={() => setExpanded(true)}
      >
        {JSON.stringify(`${value.slice(0, 24)}…${value.slice(-16)}`)}
      </button>
    );
  }
  if (value.length <= MAX_STRING_PREVIEW) {
    return <span className="text-success-foreground">{JSON.stringify(value)}</span>;
  }
  return (
    <span className="text-success-foreground">
      {JSON.stringify(value.slice(0, MAX_STRING_PREVIEW))}
      <button
        type="button"
        className="ml-1 text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(true)}
      >
        … {value.length - MAX_STRING_PREVIEW} more
      </button>
    </span>
  );
}

function JsonLeaf({ value }: { readonly value: unknown }) {
  if (typeof value === "string") return <JsonString value={value} />;
  if (typeof value === "number") return <span className="text-info-foreground">{value}</span>;
  return <span className="text-warning-foreground">{String(value)}</span>;
}

function JsonNode(props: {
  readonly name: string | null;
  readonly value: unknown;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen);
  const name =
    props.name === null ? null : <span className="text-muted-foreground">{props.name}: </span>;
  if (typeof props.value !== "object" || props.value === null) {
    return (
      <div className="pl-3.5">
        {name}
        <JsonLeaf value={props.value} />
      </div>
    );
  }
  const isArray = Array.isArray(props.value);
  const entries = Object.entries(props.value);
  const summary = isArray
    ? `[${entries.length} item${entries.length === 1 ? "" : "s"}]`
    : `{${entries.length} key${entries.length === 1 ? "" : "s"}}`;
  if (entries.length === 0) {
    return (
      <div className="pl-3.5">
        {name}
        <span className="text-muted-foreground">{isArray ? "[]" : "{}"}</span>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        className="flex items-start gap-0.5 text-left hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon
          className={cn("mt-0.5 size-3 shrink-0 text-muted-foreground", open && "rotate-90")}
        />
        <span>
          {name}
          {open ? null : <span className="text-muted-foreground">{summary}</span>}
        </span>
      </button>
      {/* Children mount only when open, so a large result costs nothing until explored. */}
      {open ? (
        <div className="ml-1.5 border-l border-border/50 pl-1.5">
          {entries.map(([key, value]) => (
            <JsonNode key={key} name={key} value={value} defaultOpen={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A JSON result as a tree: the top level open, everything deeper one click away. */
export function ToolJsonTree({ value }: { readonly value: object }) {
  return (
    <div className="max-h-80 overflow-auto text-foreground/85">
      <JsonNode name={null} value={value} defaultOpen />
    </div>
  );
}
