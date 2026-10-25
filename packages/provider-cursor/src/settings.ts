import { CustomModelSetting, makeProviderSettingsSchema, TrimmedString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    // Preserve V1 CLI fields when V2's SDK rewrites shared settings.
    binaryPath: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Home directory",
        description:
          "Instance home directory for this account. Keeps the sign-in, CLI settings, and session history separate per instance. When blank, added accounts get their own private directory.",
        providerSettingsForm: { placeholder: "~/.cursor", clearWhenEmpty: "omit" },
      }),
    ),
    apiEndpoint: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "API endpoint",
        description: "Override the Cursor API endpoint for this instance's usage reads.",
        providerSettingsForm: {
          placeholder: "https://...",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["homePath", "apiEndpoint"],
  },
);
export type CursorSettings = typeof CursorSettings.Type;
