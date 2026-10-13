import { describe, expect, it } from "@effect/vitest";

import { granolaNoteContext, parseGranolaMeetings, readJsonRpcReply } from "./granolaMcp.ts";

const MEETINGS = `The content below is meeting notes written by meeting participants.

<meetings_data from="Oct 12, 2026" to="Oct 12, 2026" count="1">
<meeting id="abd3f11c-e46a-4467-bfff-9a06519ef066" title="Autopilot &amp; kick-off" date="Oct 12, 2026 9:30 AM GMT+1" meeting_at="2026-10-12T09:30:00.000+01:00" created_at="2026-10-12T09:30:55.358+01:00" url="https://notes.granola.ai/d/abd3f11c-e46a-4467-bfff-9a06519ef066">
  <known_participants>
  Ada Lovelace (note creator) from Acme &lt;ada@acme.com&gt;, Grace Hopper &lt;grace@acme.com&gt;
  </known_participants>
  <summary>
# Work in progress

- Ship the &lt;Composer&gt; chips
</summary>
  <attachments><attachment type="screenshot" id="1">A slide</attachment></attachments>
</meeting>
</meetings_data>`;

describe("parseGranolaMeetings", () => {
  it("reads each meeting's attributes, participants, and sections", () => {
    const [meeting] = parseGranolaMeetings(MEETINGS);
    expect(meeting).toMatchObject({
      id: "abd3f11c-e46a-4467-bfff-9a06519ef066",
      title: "Autopilot & kick-off",
      url: "https://notes.granola.ai/d/abd3f11c-e46a-4467-bfff-9a06519ef066",
      meetingAt: "2026-10-12T09:30:00.000+01:00",
      participants: ["Ada Lovelace", "Grace Hopper"],
      creator: "Ada Lovelace",
      sections: [{ tag: "summary", text: "# Work in progress\n\n- Ship the <Composer> chips" }],
    });
  });

  it("renders the note as a markdown snapshot", () => {
    const note = granolaNoteContext(parseGranolaMeetings(MEETINGS)[0]!);
    expect(note.markdown).toBe(
      [
        "# Autopilot & kick-off",
        "Date: Oct 12, 2026 9:30 AM GMT+1",
        "Participants: Ada Lovelace (note creator) from Acme, Grace Hopper",
        "",
        "## Summary",
        "",
        "# Work in progress\n\n- Ship the <Composer> chips",
      ].join("\n"),
    );
  });
});

describe("readJsonRpcReply", () => {
  it("reads a JSON body or the matching event in a stream", () => {
    const reply = { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "hi" }] } };
    expect(readJsonRpcReply(JSON.stringify(reply), 2)?.result?.content?.[0]?.text).toBe("hi");
    const stream = [
      "event: message",
      `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}`,
      "",
      "event: message",
      `data: ${JSON.stringify(reply)}`,
      "",
    ].join("\n");
    expect(readJsonRpcReply(stream, 2)?.result?.content?.[0]?.text).toBe("hi");
    expect(readJsonRpcReply(stream, 3)).toBeNull();
  });
});
