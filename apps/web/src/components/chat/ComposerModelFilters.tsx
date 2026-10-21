import type { ProviderInstanceId } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "~/providerInstances";

import { Button } from "../ui/button";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

/**
 * Fork: the `@` menu Models tab's provider filter. Pressing a button must not take focus from the
 * composer, whose caret keeps the `@` query open.
 */
export function ComposerModelFilters(props: {
  instances: ReadonlyArray<ProviderInstanceEntry>;
  selected: ProviderInstanceId | null;
  onSelect: (instanceId: ProviderInstanceId | null) => void;
}) {
  if (props.instances.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="Filter models by provider"
      className="flex gap-1 overflow-x-auto px-3 pt-1.5 [scrollbar-width:none]"
    >
      <Button
        type="button"
        size="xs"
        variant={props.selected === null ? "secondary" : "ghost-muted"}
        aria-pressed={props.selected === null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => props.onSelect(null)}
      >
        All providers
      </Button>
      {props.instances.map((entry) => {
        const active = props.selected === entry.instanceId;
        return (
          <Button
            key={entry.instanceId}
            type="button"
            size="xs"
            variant={active ? "secondary" : "ghost-muted"}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(active ? null : entry.instanceId)}
          >
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              acpRegistryAgentId={entry.acpRegistryAgentId}
              acpRegistryIconUrl={entry.acpRegistryIconUrl}
              size="compact"
            />
            {entry.displayName}
          </Button>
        );
      })}
    </div>
  );
}
