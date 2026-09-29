import { linearAppUrl } from "@t3tools/client-runtime/state/linear";
import { type MouseEvent, useCallback } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";

type LinkClickHandler = (event: MouseEvent<HTMLElement>, url: string) => void;

/**
 * Click handler for "Open in Linear" links. With Settings → Integrations → Linear set to the
 * Linear app, a linear.app link opens there; otherwise, or if the app cannot be reached, the
 * link takes the usual `fallback` path ("Open links in").
 */
export function useLinearLinkClickHandler(fallback: LinkClickHandler): LinkClickHandler {
  const target = useClientSettings((settings) => settings.linearLinkTarget);
  return useCallback(
    (event, url) => {
      const appUrl = target === "app" ? linearAppUrl(url) : null;
      const api = readLocalApi();
      if (appUrl === null || !api) {
        fallback(event, url);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // No Linear app to handle the scheme: open the web page instead of dropping the click.
      void api.shell.openExternal(appUrl).catch(() => api.shell.openExternal(url));
    },
    [fallback, target],
  );
}
