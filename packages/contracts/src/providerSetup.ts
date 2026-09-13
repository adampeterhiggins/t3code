import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ProviderSetupInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderSetupInput = typeof ProviderSetupInput.Type;

/**
 * How a provider authentication method produces credentials.
 *
 *   - `sign-in-flow`    — runs the provider's own interactive login
 *     (browser OAuth, device code, or a CLI prompt that accepts a pasted
 *     response). The flow may publish an authorization URL and/or request
 *     pasted input while it runs.
 *   - `saved-credentials` — re-detect credentials the provider CLI already
 *     holds on this environment (keychain entries, CLI credential files).
 *     No input required; succeeds or fails after a probe.
 *   - `paste-credential` — the user pastes a key/token which the server
 *     stores (sensitive environment variable or provider credential file).
 */
export const ProviderAuthMethodKind = Schema.Literals([
  "sign-in-flow",
  "saved-credentials",
  "paste-credential",
]);
export type ProviderAuthMethodKind = typeof ProviderAuthMethodKind.Type;

/** One selectable way to authenticate a provider instance, advertised on `ServerProvider.setup`. */
export const ProviderAuthMethod = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  kind: ProviderAuthMethodKind,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  /** `paste-credential` only: label for the secret input. */
  credentialLabel: Schema.optional(TrimmedNonEmptyString),
  credentialPlaceholder: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderAuthMethod = typeof ProviderAuthMethod.Type;

/**
 * `provider.auth.start` payload. `methodId` picks one of the advertised
 * `setup.authMethods`; when omitted the provider runs its default method.
 * `credential` carries the pasted secret for `paste-credential` methods.
 */
export const ProviderAuthStartInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  methodId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  credential: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(16_384))),
});
export type ProviderAuthStartInput = typeof ProviderAuthStartInput.Type;

const SetupOperationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const ProviderAuthState = Schema.Struct({
  instanceId: ProviderInstanceId,
  phase: Schema.Literals([
    "idle",
    "starting",
    "waiting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  flowId: Schema.NullOr(SetupOperationId),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
  /**
   * While `phase === "waiting"`, a human-readable label for a value the
   * client should collect and send back through `provider.auth.complete`
   * (as `callbackUrl`) — e.g. a one-time code or device-auth confirmation.
   */
  inputPrompt: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderAuthState = typeof ProviderAuthState.Type;

export const ProviderAuthCompleteInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type ProviderAuthCompleteInput = typeof ProviderAuthCompleteInput.Type;

export const ProviderAuthCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: SetupOperationId,
});
export type ProviderAuthCancelInput = typeof ProviderAuthCancelInput.Type;

const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ProviderInstallState = Schema.Struct({
  driver: ProviderDriverKind,
  operationId: Schema.NullOr(SetupOperationId),
  phase: Schema.Literals([
    "idle",
    "downloading",
    "extracting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  downloadedBytes: ByteCount,
  totalBytes: Schema.NullOr(ByteCount),
  version: Schema.NullOr(TrimmedNonEmptyString),
  installedVersion: Schema.NullOr(TrimmedNonEmptyString),
  canRemove: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type ProviderInstallState = typeof ProviderInstallState.Type;

export const ProviderInstallCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  operationId: SetupOperationId,
});
export type ProviderInstallCancelInput = typeof ProviderInstallCancelInput.Type;

/** Safe setup failure text. Never include OAuth codes, URLs, or native token data. */
export class ProviderSetupError extends Schema.TaggedError<ProviderSetupError>()(
  "ProviderSetupError",
  {
    instanceId: ProviderInstanceId,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
