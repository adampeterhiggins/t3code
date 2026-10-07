import { createFileRoute } from "@tanstack/react-router";
import { OrganisationsSettings } from "../components/settings/OrganisationsSettings";

export const Route = createFileRoute("/settings/organisations")({
  component: OrganisationsSettings,
});
