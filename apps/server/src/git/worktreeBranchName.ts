import type { ChatAttachment, ServerSettings } from "@t3tools/contracts";
import { buildGeneratedWorktreeBranchName } from "@t3tools/shared/git";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";
import * as Effect from "effect/Effect";

import type * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import type * as TextGeneration from "../textGeneration/TextGeneration.ts";

/**
 * The branch a thread's temporary worktree branch should be renamed to, named
 * from the thread's first message and namespaced by the branch prefix setting.
 * Worktree bootstrap calls this before the first turn so the agent starts on
 * the final branch; the provider command reactor calls it as a fallback.
 */
export const generateWorktreeBranchName = Effect.fn("generateWorktreeBranchName")(function* (
  services: {
    readonly textGeneration: TextGeneration.TextGeneration["Service"];
    readonly providerRegistry: ProviderRegistry.ProviderRegistry["Service"];
  },
  input: {
    readonly cwd: string;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
    readonly settings: ServerSettings;
  },
) {
  const { settings } = input;
  const modelSelection =
    settings.sourceControlWriterModelSelection === null
      ? settings.textGenerationModelSelection
      : resolveSourceControlWriterModelSelection(
          settings,
          yield* services.providerRegistry.getProviders,
        );
  const generated = yield* services.textGeneration.generateBranchName({
    cwd: input.cwd,
    message: input.messageText,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    modelSelection,
  });
  return buildGeneratedWorktreeBranchName(generated.branch, settings.worktreeBranchPrefix);
});
