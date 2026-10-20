import { createFileRoute } from "@tanstack/react-router";

import { QuickMessagePanel } from "../components/quickMessage/QuickMessagePanel";

export const Route = createFileRoute("/quick-message")({
  component: QuickMessagePanel,
});
