import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DesktopServerExposureModeSchema } from "./ipc.ts";

export const DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION = 1 as const;

export const DesktopAppActivationPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type DesktopAppActivationPlatform = typeof DesktopAppActivationPlatform.Type;

export const DesktopAppActivationRequest = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  type: Schema.Literal("open-workspace"),
  workspaceRoot: TrimmedNonEmptyString,
  platform: DesktopAppActivationPlatform,
});
export type DesktopAppActivationRequest = typeof DesktopAppActivationRequest.Type;

/** Reads the desktop's network access mode, or changes it when `mode` is set. */
export const DesktopAppNetworkAccessRequest = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  type: Schema.Literal("network-access"),
  mode: Schema.optionalKey(DesktopServerExposureModeSchema),
});
export type DesktopAppNetworkAccessRequest = typeof DesktopAppNetworkAccessRequest.Type;

export const DesktopAppControlRequest = Schema.Union([
  DesktopAppActivationRequest,
  DesktopAppNetworkAccessRequest,
]);
export type DesktopAppControlRequest = typeof DesktopAppControlRequest.Type;

export const DesktopAppActivationErrorCode = Schema.Literals([
  "invalid-request",
  "renderer-unavailable",
  "environment-unavailable",
  "platform-mismatch",
  "project-create-failed",
  "thread-open-failed",
  "network-address-unavailable",
  "request-timeout",
  "internal-error",
]);
export type DesktopAppActivationErrorCode = typeof DesktopAppActivationErrorCode.Type;

export const DesktopAppActivationSuccess = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(true),
  projectId: ProjectId,
  threadId: ThreadId,
});
export type DesktopAppActivationSuccess = typeof DesktopAppActivationSuccess.Type;

export const DesktopAppNetworkAccessSuccess = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(true),
  mode: DesktopServerExposureModeSchema,
  endpointUrl: Schema.NullOr(Schema.String),
  // The desktop relaunches after sending this, which restarts its server.
  restarting: Schema.Boolean,
});
export type DesktopAppNetworkAccessSuccess = typeof DesktopAppNetworkAccessSuccess.Type;

export const DesktopAppActivationFailure = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(false),
  code: DesktopAppActivationErrorCode,
  message: TrimmedNonEmptyString,
});
export type DesktopAppActivationFailure = typeof DesktopAppActivationFailure.Type;

export const DesktopAppActivationResponse = Schema.Union([
  DesktopAppActivationSuccess,
  DesktopAppActivationFailure,
]);
export type DesktopAppActivationResponse = typeof DesktopAppActivationResponse.Type;

export const DesktopAppNetworkAccessResponse = Schema.Union([
  DesktopAppNetworkAccessSuccess,
  DesktopAppActivationFailure,
]);
export type DesktopAppNetworkAccessResponse = typeof DesktopAppNetworkAccessResponse.Type;

export type DesktopAppControlResponse =
  | DesktopAppActivationResponse
  | DesktopAppNetworkAccessResponse;
