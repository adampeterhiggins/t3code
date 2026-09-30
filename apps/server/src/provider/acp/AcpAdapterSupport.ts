import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  type ProviderAdapterError,
} from "../Errors.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterProcessError({
      provider,
      threadId,
      detail: error.message,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: error.message,
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
    cause: error,
  });
}

export function acpPermissionOutcome(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "acceptForSession":
      return "allow-always";
    case "accept":
      return "allow-once";
    case "decline":
    default:
      return "reject-once";
  }
}

/**
 * The agent's own option for a T3 approval decision, matched by option kind
 * because option ids are agent-defined. "Always allow" falls back to "allow
 * once" for agents that only offer the latter.
 */
export function selectAcpPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: Exclude<ProviderApprovalDecision, "cancel">,
): string | undefined {
  const preferredKind =
    decision === "acceptForSession"
      ? "allow_always"
      : decision === "accept"
        ? "allow_once"
        : "reject_once";
  const preferredId = request.options
    .find((entry) => entry.kind === preferredKind)
    ?.optionId.trim();
  if (preferredId) {
    return preferredId;
  }
  if (decision === "acceptForSession") {
    return (
      request.options.find((entry) => entry.kind === "allow_once")?.optionId.trim() || undefined
    );
  }
  return undefined;
}

/** The option full access picks without asking: "always allow", else "allow once". */
export function selectAcpAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  return selectAcpPermissionOptionId(request, "acceptForSession");
}

/**
 * The first advertised session mode matching one of `aliases`, in alias
 * order. Exact id or name matches win over substring matches.
 */
export function findAcpModeByAliases<Mode extends { readonly id: string; readonly name: string }>(
  modes: ReadonlyArray<Mode>,
  aliases: ReadonlyArray<string>,
): Mode | undefined {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find(
      (mode) => mode.id.toLowerCase() === alias || mode.name.toLowerCase() === alias,
    );
    if (exact) return exact;
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalize(`${mode.id} ${mode.name}`).includes(alias));
    if (partial) return partial;
  }
  return undefined;
}

/**
 * Map a `session/elicitation` form request to user-input questions. Enum
 * properties become fixed choices; everything else takes a custom answer.
 * URL-mode elicitations cannot be answered in the chat UI.
 */
export function extractAcpElicitationQuestions(
  params: Extract<EffectAcpSchema.ElicitationRequest, { readonly mode: "form" }>,
): ReadonlyArray<UserInputQuestion> {
  const properties = params.requestedSchema.properties ?? {};
  return Object.entries(properties).map(([id, property]) => {
    const options =
      "enum" in property && Array.isArray(property.enum)
        ? property.enum
            .filter((value): value is string => typeof value === "string")
            .map((value) => ({ label: value, description: value }))
        : [];
    return {
      id,
      header: property.title?.trim() || id,
      question: property.description?.trim() || property.title?.trim() || params.message,
      options,
      allowCustomAnswer: true,
      multiSelect: property.type === "array",
    };
  });
}

/** The elicitation response for user-input answers. No answers cancels. */
export function acpElicitationResponseFromAnswers(
  answers: Readonly<Record<string, unknown>>,
): EffectAcpSchema.ElicitationResponse {
  if (Object.keys(answers).length === 0) {
    return { action: { action: "cancel" } };
  }
  const content: Record<string, string | number | boolean | ReadonlyArray<string>> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === "string" || typeof value === "boolean") {
      content[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      content[key] = value;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      content[key] = value;
    }
  }
  return { action: { action: "accept", content } };
}
