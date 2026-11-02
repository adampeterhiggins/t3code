import type { UserInputAttachmentAnswerPayload } from "@t3tools/contracts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getQuestionAnswerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getQuestionAnswerText).filter(Boolean).join(", ");
  const nested = record(value);
  return nested ? getQuestionAnswerText(nested.answers) : "";
}

export function getQuestionTextPreview(answer: UserInputAttachmentAnswerPayload): string {
  return Object.values(answer.questionTextById ?? {})
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

export function getQuestionAnswerPreview(answer: UserInputAttachmentAnswerPayload): string {
  const answers = Object.values(answer.answers).map(getQuestionAnswerText).filter(Boolean);
  const attachments = Object.values(answer.attachmentsByQuestionId)
    .flat()
    .map((attachment) => attachment.name);
  return (
    answers.length > 0
      ? answers.join(" · ")
      : attachments.length > 0
        ? attachments.join(", ")
        : Object.values(answer.questionTextById ?? {}).join(" · ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function hasQuestionAnswer(answer: UserInputAttachmentAnswerPayload): boolean {
  return (
    Object.values(answer.answers).some(getQuestionAnswerText) ||
    Object.values(answer.attachmentsByQuestionId).some((attachments) => attachments.length > 0)
  );
}

export function getQuestionAnswerRows(answer: UserInputAttachmentAnswerPayload) {
  const ids = new Set([
    ...Object.keys(answer.questionTextById ?? {}),
    ...Object.keys(answer.answers),
    ...Object.keys(answer.attachmentsByQuestionId),
  ]);
  return Array.from(ids, (id) => ({
    id,
    question: answer.questionTextById?.[id]?.replace(/\s+/g, " ").trim() ?? id,
    answer: (
      getQuestionAnswerText(answer.answers[id]) ||
      (answer.attachmentsByQuestionId[id] ?? []).map((attachment) => attachment.name).join(", ")
    )
      .replace(/\s+/g, " ")
      .trim(),
  }));
}
