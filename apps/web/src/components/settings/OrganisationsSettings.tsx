import type { Organisation } from "@t3tools/contracts/settings";
import { T, useGT } from "gt-react";
import { lazy, Suspense, useState } from "react";

import { useOrganisations } from "../../hooks/useOrganisations";
import { buildOrganisationOptions, type OrganisationOption } from "../sidebar/organization.logic";
import { githubAvatarUrlOf, OrganisationIcon } from "../sidebar/OrganisationIcon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

/** Names and icons for the repository owners the sidebar's Organisations filter lists. */
export function OrganisationsSettings() {
  const gt = useGT();
  const groups = useSettingsProjectGroups();
  const { organisations, saveOrganisation } = useOrganisations();
  const options = buildOrganisationOptions(
    groups.flatMap((group) => group.memberProjects.map((member) => member.repositoryIdentity)),
    organisations,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="organisations" title={gt("Organisations")}>
        {options.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
            <T>
              Organisations come from your projects' git remotes. Add a project with a remote to
              name and style its organisation.
            </T>
          </p>
        ) : (
          options.map((option) => (
            <OrganisationRow
              key={option.key}
              option={option}
              onSave={(organisation) => saveOrganisation(option.key, organisation)}
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function OrganisationRow(props: {
  option: OrganisationOption;
  onSave: (organisation: Organisation) => void;
}) {
  const gt = useGT();
  const { option } = props;
  const current = option.organisation ?? {};
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const hasGithubAvatar = githubAvatarUrlOf(option.key) !== null;
  const save = (patch: { name?: string | undefined; icon?: Organisation["icon"] | undefined }) => {
    const { name, icon } = { ...current, ...patch };
    props.onSave({
      ...(name !== undefined ? { name } : {}),
      ...(icon != null ? { icon } : {}),
    });
  };
  const saveName = (value: string) => {
    const name = value.trim();
    // Typing the default label back clears the override rather than pinning it.
    const next = name === "" || name === option.defaultLabel ? undefined : name;
    if (next !== current.name) save({ name: next });
  };

  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <OrganisationIcon option={option} />
          <span className="truncate">{option.label}</span>
        </span>
      }
      description={option.key}
      resetAction={
        option.organisation ? (
          <SettingResetButton
            ariaLabel={gt("Reset {organisation} name and icon to default", {
              organisation: option.label,
            })}
            onClick={() => props.onSave({})}
          />
        ) : null
      }
      control={
        <div className="flex items-center gap-2">
          <Input
            key={`${option.key}:${current.name ?? ""}`}
            size="sm"
            className="w-full sm:w-48"
            aria-label={gt("{organisation} display name", { organisation: option.defaultLabel })}
            placeholder={option.defaultLabel}
            defaultValue={current.name ?? ""}
            onBlur={(event) => saveName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {hasGithubAvatar && current.icon != null ? (
            <Button
              size="sm"
              variant="outline"
              type="button"
              aria-label={gt("Use the GitHub avatar for {organisation}", {
                organisation: option.label,
              })}
              onClick={() => save({ icon: undefined })}
            >
              <T>Use GitHub avatar</T>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            type="button"
            aria-label={gt("Choose an icon for {organisation}", { organisation: option.label })}
            onClick={() => setIconPickerOpen(true)}
          >
            <T>Choose icon</T>
          </Button>
          {iconPickerOpen ? (
            <Suspense fallback={null}>
              <ProjectIconPickerDialog
                current={current.icon ?? null}
                projectName={option.label}
                title={gt("Choose organisation icon")}
                open
                onOpenChange={setIconPickerOpen}
                onSelect={(icon) => save({ icon })}
              />
            </Suspense>
          ) : null}
        </div>
      }
    />
  );
}
