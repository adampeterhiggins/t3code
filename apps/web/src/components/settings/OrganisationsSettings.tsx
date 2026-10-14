import type { Organisation } from "@t3tools/contracts/settings";
import { lazy, Suspense, useMemo, useState } from "react";

import { useOrganisations } from "../../hooks/useOrganisations";
import { buildOrganisationOptions, type OrganisationOption } from "../Sidebar.logic";
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
  const groups = useSettingsProjectGroups();
  const { organisations, saveOrganisation } = useOrganisations();
  const options = useMemo(
    () =>
      buildOrganisationOptions(
        groups.flatMap((group) => group.memberProjects.map((member) => member.repositoryIdentity)),
        organisations,
      ),
    [groups, organisations],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="organisations" title="Organisations">
        {options.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
            Organisations come from your projects' git remotes. Add a project with a remote to name
            and style its organisation.
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
  const { option } = props;
  const current = option.organisation ?? {};
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const hasGithubAvatar = githubAvatarUrlOf(option.key) !== null;
  // An icon and the GitHub avatar replace each other.
  const save = (patch: {
    name?: string | undefined;
    icon?: Organisation["icon"] | undefined;
    githubAvatar?: true | undefined;
  }) => {
    const { name, icon, githubAvatar } = { ...current, ...patch };
    props.onSave({
      ...(name !== undefined ? { name } : {}),
      ...(icon != null ? { icon } : {}),
      ...(githubAvatar ? { githubAvatar } : {}),
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
            label={`${option.label} name and icon`}
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
            aria-label={`${option.defaultLabel} display name`}
            placeholder={option.defaultLabel}
            defaultValue={current.name ?? ""}
            onBlur={(event) => saveName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {hasGithubAvatar && !current.githubAvatar ? (
            <Button
              size="sm"
              variant="outline"
              type="button"
              aria-label={`Use the GitHub avatar for ${option.label}`}
              onClick={() => save({ githubAvatar: true, icon: undefined })}
            >
              Use GitHub avatar
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            type="button"
            aria-label={`Choose an icon for ${option.label}`}
            onClick={() => setIconPickerOpen(true)}
          >
            Choose icon
          </Button>
          {iconPickerOpen ? (
            <Suspense fallback={null}>
              <ProjectIconPickerDialog
                current={current.icon ?? null}
                projectName={option.label}
                title="Choose organisation icon"
                open
                onOpenChange={setIconPickerOpen}
                onSelect={(icon) => save({ icon, githubAvatar: undefined })}
              />
            </Suspense>
          ) : null}
        </div>
      }
    />
  );
}
