/* oxlint-disable react/no-array-index-key -- Table rows and columns have stable positions and may contain identical values. */
import { decodeFilePreviewText } from "@t3tools/shared/filePreview";
import { useEffect, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { ReadFileView } from "~/components/chat/ReadFileView";

import {
  attachmentQuickLook,
  QUICK_LOOK_BYTES,
  type AttachmentQuickLook,
} from "./AttachmentQuickLook.logic";

const FRAME_CLASS = "max-h-72 overflow-hidden rounded-t-lg border-b border-border/70 bg-muted/40";

/**
 * Fork: a glance at a local text attachment for its chip's hover card: rendered Markdown, a
 * small CSV or TSV table, or source highlighted for its language. Reads only the opening bytes,
 * and renders nothing for binary or empty files.
 */
export function AttachmentQuickLookPreview(props: { file: Blob; name: string; mimeType: string }) {
  const { file, name, mimeType } = props;
  const [loaded, setLoaded] = useState<{ file: Blob; look: AttachmentQuickLook | null }>();
  useEffect(() => {
    let cancelled = false;
    const complete = file.size <= QUICK_LOOK_BYTES;
    void file
      .slice(0, QUICK_LOOK_BYTES)
      .arrayBuffer()
      .then((buffer) => {
        const { text } = decodeFilePreviewText(new Uint8Array(buffer), !complete);
        return attachmentQuickLook({ name, mimeType }, text, complete);
      })
      .catch(() => null)
      .then((look) => {
        if (!cancelled) setLoaded({ file, look });
      });
    return () => {
      cancelled = true;
    };
  }, [file, mimeType, name]);
  const look = loaded?.file === file ? loaded.look : null;
  if (look === null) return null;
  if (look.kind === "markdown") {
    return (
      <div className={FRAME_CLASS}>
        <ChatMarkdown text={look.text} cwd={undefined} className="px-3 py-2 text-xs" />
      </div>
    );
  }
  if (look.kind === "table") {
    const [header, ...body] = look.rows;
    return (
      <div className={FRAME_CLASS}>
        <table className="w-full border-separate border-spacing-0 text-3xs" aria-label={name}>
          {header ? (
            <thead>
              <tr>
                {header.map((cell, columnIndex) => (
                  <th
                    key={columnIndex}
                    scope="col"
                    className="max-w-32 truncate border-b border-border bg-muted/60 px-2 py-1 text-left font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="even:bg-muted/30">
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="max-w-32 truncate border-b border-border/60 px-2 py-1 tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ReadFileView
      file={{ path: name, text: look.text, startLine: 1 }}
      className={`${FRAME_CLASS} px-3 py-2 [scrollbar-width:none]`}
    />
  );
}
