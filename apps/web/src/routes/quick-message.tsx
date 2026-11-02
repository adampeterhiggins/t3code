import { createFileRoute } from "@tanstack/react-router";

import { LegacyQuickMessageUnavailableNotice } from "../components/quickMessage/QuickMessageSignInNotice";

/**
 * Read-only landing for a quick-message window that does not carry the isolated
 * session marker. The root guard sends that window here before any chat route
 * can mount. This route does not write a draft.
 */
export const Route = createFileRoute("/quick-message")({
  component: LegacyQuickMessageUnavailableNotice,
});
