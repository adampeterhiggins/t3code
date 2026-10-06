import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import { type DevinSettings, TextGenerationError } from "@t3tools/contracts";

import * as TextGenerationOperations from "./TextGenerationOperations.ts";
import {
  applyDevinAcpModelSelection,
  makeDevinAcpRuntime,
} from "../provider/acp/DevinAcpSupport.ts";

const DEVIN_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

/**
 * Build a Devin text-generation closure bound to a specific `DevinSettings`
 * payload. See `makeCursorTextGeneration` for the overall per-instance
 * rationale.
 */
export const makeDevinTextGeneration = Effect.fn("makeDevinTextGeneration")(function* (
  devinSettings: DevinSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const runDevinJson: TextGenerationOperations.Runner = (request) => {
    const { operation, cwd, prompt, modelSelection } = request;
    return Effect.gen(function* () {
      const outputRef = yield* Ref.make("");
      const runtime = yield* makeDevinAcpRuntime({
        devinSettings,
        environment: resolvedEnvironment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));

      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(outputRef, (current) => current + content.text);
      });

      const promptResult = yield* Effect.gen(function* () {
        yield* runtime.start();
        // `ask` keeps text generation read-only regardless of the session's
        // permission posture.
        yield* Effect.ignore(runtime.setMode("ask"));
        yield* applyDevinAcpModelSelection({
          runtime,
          model: modelSelection.model,
          selections: modelSelection.options,
          mapError: (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to set Devin ACP model for text generation.",
              cause,
            }),
        });

        return yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
      }).pipe(
        Effect.timeoutOption(DEVIN_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Devin request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: "Devin ACP request failed.",
                cause,
              }),
        ),
      );

      const rawResult = (yield* Ref.get(outputRef)).trim();
      if (!rawResult) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Devin ACP request was cancelled."
              : "Devin returned empty output.",
        });
      }

      return yield* TextGenerationOperations.decodeJsonReply(request, "Devin", rawResult);
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Devin ACP text generation failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );
  };

  return TextGenerationOperations.fromRunner("DevinTextGeneration", runDevinJson);
});
