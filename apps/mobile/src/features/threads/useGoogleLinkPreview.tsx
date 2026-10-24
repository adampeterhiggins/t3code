import { googleFileContextRecord } from "@t3tools/client-runtime/state/google";
import {
  parseGoogleFileLink,
  type EnvironmentId,
  type GoogleFileContextRecord,
} from "@t3tools/contracts";
import { useState } from "react";
import { ComposerContextSheet } from "../../components/ComposerContextSheet";
import { googleEnvironment } from "../../state/google";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentServerConfig } from "../../state/entities";

/** Touch opens the same location-specific source that web previews on hover. */
export function useGoogleLinkPreview(environmentId: EnvironmentId) {
  const config = useEnvironmentServerConfig(environmentId);
  const getFile = useAtomCommand(googleEnvironment.getFile);
  const [source, setSource] = useState<GoogleFileContextRecord | null>(null);
  return {
    open: (url: string) => {
      if (!config?.settings.enableGoogleIntegration || !parseGoogleFileLink(url)) return false;
      void getFile({ environmentId, input: { id: url } }).then((result) => {
        if (result._tag === "Success") setSource(googleFileContextRecord(result.value));
      });
      return true;
    },
    sheet: source ? (
      <ComposerContextSheet
        environmentId={environmentId}
        label={source.label}
        record={source}
        onClose={() => setSource(null)}
      />
    ) : null,
  };
}
