import { createFileRoute } from "@tanstack/react-router";
import { OrganisationsSettings } from "../components/settings/OrganisationsSettings";

export const Route = createFileRoute("/_chat/settings/organisations")({
  component: OrganisationsSettings,
});
