import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveHandoffEndpoints, type HandoffEndpoints } from "@t3tools/client-runtime/handoff";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  forkAccountChangeLabel,
  forkSourceInstanceId,
  formatModelSelectionTraits,
  handoffInstancesDiffer,
  modelOptionDescriptors,
  modelSelectionChanged,
  providerAccountLabel,
} from "@t3tools/shared/modelChangeMarker";
import {
  isWorkspaceChangeNotice,
  WORKSPACE_CHANGED_NOTICE_TITLE,
} from "@t3tools/shared/workspaceChangeNotice";
import {
  ProviderInstanceId,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { Fragment, useMemo } from "react";
import { Alert, Pressable, View, type ColorValue } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentThreadDetails } from "../../state/threads";
import { serverEnvironment } from "../../state/server";
import { ThreadContextDivider } from "./thread-context-divider";

function handoffEndpointsAtom(
  environmentId: EnvironmentId,
  { item, sourceThreadId }: OrchestrationV2ProjectedTurnItem,
) {
  let previous: ReturnType<typeof resolveHandoffEndpoints> | null = null;
  const ref = scopeThreadRef(environmentId, sourceThreadId);
  return Atom.make((get) => {
    if (item.type !== "handoff") return null;
    const projection = get(environmentThreadDetails.threadAtom(ref))?.projection;
    const next = resolveHandoffEndpoints(item, projection?.runs ?? []);
    // Run activity changes frequently; only endpoint changes affect this row.
    if (JSON.stringify(next) !== JSON.stringify(previous)) previous = next;
    return previous;
  });
}

export function ThreadHandoffRow(props: {
  environmentId: EnvironmentId;
  projectedItem: OrchestrationV2ProjectedTurnItem;
  iconColor: ColorValue;
}) {
  const { item } = props.projectedItem;
  const endpointsAtom = useMemo(
    () => handoffEndpointsAtom(props.environmentId, props.projectedItem),
    [props.environmentId, props.projectedItem],
  );
  const endpoints = useAtomValue(endpointsAtom);
  if (item.type !== "handoff" || endpoints === null) return null;
  const color = item.status === "failed" ? "#e11d48" : props.iconColor;
  return (
    <ThreadHandoffDivider
      environmentId={props.environmentId}
      endpoints={endpoints}
      iconColor={color}
      label="Context handoff"
      failed={item.status === "failed"}
    />
  );
}

export function ThreadHandoffDivider(props: {
  environmentId: EnvironmentId;
  endpoints: HandoffEndpoints;
  iconColor: ColorValue;
  label: string;
  failed?: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const { endpoints } = props;
  const providers = config?.providers ?? [];
  const showAccount = handoffInstancesDiffer(
    endpoints.from.map((endpoint) => endpoint.instanceId),
    endpoints.to.instanceId,
  );

  return (
    <ThreadContextDivider
      label={props.label}
      icon="arrow.left.arrow.right"
      iconColor={props.iconColor}
      failed={props.failed}
    >
      <View className="flex-row flex-wrap items-center justify-center gap-1.5">
        {endpoints.from.map((endpoint, index) => (
          <Fragment key={`${endpoint.instanceId}:${endpoint.model ?? ""}`}>
            {index > 0 ? (
              <Text accessible={false} className="text-xs text-foreground-muted">
                ,
              </Text>
            ) : null}
            <HandoffEndpoint
              {...endpoint}
              providers={providers}
              account={showAccount ? providerAccountLabel(providers, endpoint.instanceId) : null}
            />
          </Fragment>
        ))}
        {endpoints.from.length > 0 ? (
          <SymbolView name="arrow.right" size={12} tintColor={props.iconColor} />
        ) : null}
        <HandoffEndpoint
          {...endpoints.to}
          providers={config?.providers ?? []}
          account={showAccount ? providerAccountLabel(providers, endpoints.to.instanceId) : null}
        />
      </View>
    </ThreadContextDivider>
  );
}

export function ThreadModelChangeRow(props: {
  environmentId: EnvironmentId;
  projectedItem: OrchestrationV2ProjectedTurnItem;
  iconColor: ColorValue;
}) {
  const { item } = props.projectedItem;
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  if (item.type !== "model_change") return null;
  const providers = config?.providers ?? [];
  const descriptors = modelOptionDescriptors(providers, item.from);
  // Explicitly picking an option's default records a change that is not one.
  if (!modelSelectionChanged(item.from, item.to, descriptors)) {
    return null;
  }
  const showAccount = item.from.instanceId !== item.to.instanceId;
  return (
    <ThreadContextDivider
      label="Model changed"
      icon="arrow.left.arrow.right"
      iconColor={props.iconColor}
    >
      <View className="flex-row flex-wrap items-center justify-center gap-1.5">
        <HandoffEndpoint
          instanceId={item.from.instanceId}
          model={item.from.model}
          traits={formatModelSelectionTraits(providers, item.from)}
          providers={providers}
          account={showAccount ? providerAccountLabel(providers, item.from.instanceId) : null}
        />
        <SymbolView name="arrow.right" size={12} tintColor={props.iconColor} />
        <HandoffEndpoint
          instanceId={item.to.instanceId}
          model={item.to.model}
          traits={formatModelSelectionTraits(providers, item.to)}
          providers={providers}
          account={showAccount ? providerAccountLabel(providers, item.to.instanceId) : null}
        />
      </View>
    </ThreadContextDivider>
  );
}

export function ThreadWorkspaceChangeRow(props: {
  projectedItem: OrchestrationV2ProjectedTurnItem;
  iconColor: ColorValue;
}) {
  const { item } = props.projectedItem;
  if (!isWorkspaceChangeNotice(item)) return null;
  return (
    <ThreadContextDivider
      label={WORKSPACE_CHANGED_NOTICE_TITLE}
      icon="folder.fill"
      iconColor={props.iconColor}
    >
      <Text
        className="shrink text-xs text-foreground-muted"
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {item.message}
      </Text>
    </ThreadContextDivider>
  );
}

export function ThreadForkRow(props: {
  environmentId: EnvironmentId;
  projectedItem: OrchestrationV2ProjectedTurnItem;
  iconColor: ColorValue;
}) {
  const { item } = props.projectedItem;
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  // Instance ids only: the thread projection updates on every streamed event.
  const endpointKey = useAtomValue(
    environmentThreadDetails.threadAtom(
      scopeThreadRef(props.environmentId, props.projectedItem.item.threadId),
    ),
    (thread) => {
      if (item.type !== "fork" || item.source.type !== "run") return null;
      const source = forkSourceInstanceId(thread?.projection.contextTransfers ?? [], item) ?? "";
      const target = thread?.projection.thread.modelSelection.instanceId ?? "";
      return `${source}\0${target}`;
    },
  );
  if (item.type !== "fork") return null;
  const [sourceInstanceId, targetInstanceId] = endpointKey?.split("\0") ?? [];
  const accountLabel = forkAccountChangeLabel({
    sourceInstanceId: sourceInstanceId ? ProviderInstanceId.make(sourceInstanceId) : null,
    targetInstanceId: targetInstanceId ? ProviderInstanceId.make(targetInstanceId) : null,
    providers: config?.providers ?? [],
  });
  return (
    <ThreadContextDivider
      label={
        accountLabel ??
        (item.source.type === "run" ? "Forked from conversation" : "Conversation fork")
      }
      icon="arrow.triangle.branch"
      iconColor={props.iconColor}
    />
  );
}

function HandoffEndpoint(props: {
  instanceId: ProviderInstanceId;
  model?: string | undefined;
  /** Parameters the model ran with, such as "Max Fast". */
  traits?: string | null;
  /** Account name, shown when this handoff or switch moved between accounts. */
  account?: string | null;
  providers: ReadonlyArray<ServerProvider>;
}) {
  const provider = props.providers.find((candidate) => candidate.instanceId === props.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === props.model);
  const label =
    model?.shortName ??
    model?.name ??
    props.model ??
    (provider ? resolveProviderInstanceDisplayName(provider) : props.instanceId);
  const account = props.account?.trim();
  const showAccount = account !== undefined && account.length > 0 && account !== label;
  const visible = `${showAccount ? `${account} · ` : ""}${label}${props.traits ? ` ${props.traits}` : ""}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visible}
      accessibilityHint="Show provider account"
      className="min-h-6 max-w-full flex-row items-center justify-center gap-1"
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={() =>
        Alert.alert(
          label,
          provider ? resolveProviderInstanceDisplayName(provider) : props.instanceId,
        )
      }
    >
      <ProviderIcon
        provider={provider?.driver ?? props.instanceId}
        iconUrl={provider?.iconUrl}
        size={12}
      />
      <Text numberOfLines={1} className="shrink text-xs text-foreground-muted">
        {visible}
      </Text>
    </Pressable>
  );
}
