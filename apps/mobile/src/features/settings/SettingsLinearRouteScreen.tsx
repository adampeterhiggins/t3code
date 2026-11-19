import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type LinearAssignmentTrigger,
  type LinearConnectionState,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { m, type MessageResolver } from "../../i18n/messages";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useProjects } from "../../state/entities";
import { linearEnvironment } from "../../state/linear";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

/** The Linear account belongs to each environment, so every selected one gets its own section. */
export function SettingsLinearRouteScreen() {
  const environmentMenu = useSettingsEnvironmentMenu();
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product name */}
      <SettingsScreen title="Linear" menus={[environmentMenu]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <Text className="px-2 text-sm text-foreground-muted">
            <T>
              Attach Linear issues to messages as context for the agent. The account is stored on
              the environment, so every device connected to it can use it.
            </T>
          </Text>
          {selectedTargets.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              <T>Use the filter above to select a connected environment.</T>
            </Text>
          ) : (
            selectedTargets.map((target) => (
              <LinearEnvironmentSection
                key={target.environmentId}
                environmentId={target.environmentId}
                environmentLabel={target.label}
                assignmentTriggers={target.serverConfig.settings.linearAssignmentTriggers}
              />
            ))
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function describeConnection(state: LinearConnectionState, resolve: MessageResolver = m): string {
  switch (state.phase) {
    case "connected":
      return state.account
        ? resolve(msg("Connected as {name} ({email}) in {workspace}."), {
            name: state.account.name,
            email: state.account.email,
            workspace: state.account.workspaceName,
          })
        : resolve(msg("Connected."));
    case "waiting":
      return resolve(
        msg(
          "Approve T3 Code in Linear. Your browser then lands on a page that won't load, because it points at the computer running T3 Code. Copy that page's full URL and paste it below.",
        ),
      );
    case "failed":
      return state.message ?? resolve(msg("Linear sign-in failed."));
    case "disconnected":
      return resolve(msg("Not connected."));
  }
}

function LinearEnvironmentSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly assignmentTriggers: ReadonlyArray<LinearAssignmentTrigger>;
}) {
  const { environmentId } = props;
  const gt = useGT();
  const messages = useMessages();
  const connection = useEnvironmentQuery(
    linearEnvironment.connection({ environmentId, input: {} }),
  );
  const state = connection.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startLogin = useAtomCommand(linearEnvironment.startLogin, commandOptions);
  const completeLogin = useAtomCommand(linearEnvironment.completeLogin, commandOptions);
  const cancelLogin = useAtomCommand(linearEnvironment.cancelLogin, commandOptions);
  const disconnect = useAtomCommand(linearEnvironment.disconnect, commandOptions);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState({ flowId: null as string | null, value: "" });
  const flowId = state?.phase === "waiting" ? state.flowId : null;
  const authorizationUrl = state?.phase === "waiting" ? state.authorizationUrl : null;
  // A new login flow starts with an empty field rather than a stale redirect URL.
  const pastedValue = pasted.flowId === flowId ? pasted.value : "";

  async function run<A, E>(request: () => Promise<AtomCommandResult<A, E>>) {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await request().finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : gt("Linear request failed."));
      }
      return null;
    }
    return result.value;
  }

  async function openAuthorization(url: string) {
    if (!(await tryOpenExternalUrl(url, "linear"))) {
      setError(gt("Could not open the browser. Try again."));
    }
  }

  async function connect() {
    const next = await run(() => startLogin({ environmentId, input: {} }));
    if (next?.authorizationUrl) await openAuthorization(next.authorizationUrl);
  }

  async function submitPasted() {
    if (!flowId || !pastedValue.trim()) return;
    const accepted = await run(() =>
      completeLogin({ environmentId, input: { flowId, callbackUrl: pastedValue.trim() } }),
    );
    if (accepted) setPasted({ flowId: null, value: "" });
  }

  function confirmDisconnect() {
    Dialog.confirm({
      title: gt("Disconnect Linear?"),
      message: gt(
        "Disconnect Linear from {environment}? Issues already attached to messages stay as they are.",
        { environment: props.environmentLabel },
      ),
      confirmText: gt("Disconnect"),
      destructive: true,
      onConfirm: () => void run(() => disconnect({ environmentId, input: {} })),
    });
  }

  return (
    <SettingsSection title={props.environmentLabel}>
      <View className="gap-1 p-4">
        <Text
          selectable
          className={
            state?.phase === "failed" || (!state && connection.error)
              ? "text-base text-danger-foreground"
              : "text-base text-foreground"
          }
        >
          {state
            ? describeConnection(state, messages)
            : (connection.error ?? gt("Reading Linear status…"))}
        </Text>
        {error ? (
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
      {state?.phase === "waiting" ? (
        <>
          <View className="gap-3 border-t border-border-subtle p-4">
            <Text className="text-sm font-t3-medium text-foreground">
              <T>Paste the URL from the page that didn't load</T>
            </Text>
            <AppTextInput
              accessibilityLabel={gt("Redirect URL from Linear")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={gt("Full redirect URL from Linear")}
              returnKeyType="done"
              value={pastedValue}
              editable={!pending}
              onChangeText={(value) => setPasted({ flowId, value })}
              onSubmitEditing={() => void submitPasted()}
            />
          </View>
          <SettingsActionRow
            icon="checkmark.circle"
            label={gt("Submit")}
            disabled={pending || !pastedValue.trim()}
            loading={pending}
            onPress={() => void submitPasted()}
          />
          {authorizationUrl ? (
            <SettingsActionRow
              icon="arrow.up.right"
              label={gt("Open Linear again")}
              disabled={pending}
              onPress={() => void openAuthorization(authorizationUrl)}
            />
          ) : null}
          <SettingsActionRow
            icon="xmark"
            label={gt("Cancel")}
            tone="danger"
            disabled={pending || flowId === null}
            onPress={() => {
              if (flowId) void run(() => cancelLogin({ environmentId, input: { flowId } }));
            }}
          />
        </>
      ) : state?.phase === "connected" ? (
        <SettingsActionRow
          icon="xmark.circle.fill"
          label={gt("Disconnect")}
          tone="danger"
          disabled={pending}
          loading={pending}
          onPress={confirmDisconnect}
        />
      ) : state ? (
        <SettingsActionRow
          icon="link"
          label={state.phase === "failed" ? gt("Reconnect Linear") : gt("Connect Linear")}
          disabled={pending}
          loading={pending}
          onPress={() => void connect()}
        />
      ) : null}
      <AssignmentTriggerRows
        environmentId={environmentId}
        rules={props.assignmentTriggers}
        connected={state?.phase === "connected"}
      />
    </SettingsSection>
  );
}

/**
 * Lists the environment's assignment rules so they can be removed here. Adding and editing a
 * rule needs a project and model picker, which lives in the desktop and web settings.
 */
function AssignmentTriggerRows(props: {
  readonly environmentId: EnvironmentId;
  readonly rules: ReadonlyArray<LinearAssignmentTrigger>;
  readonly connected: boolean;
}) {
  const { environmentId, rules } = props;
  const gt = useGT();
  const projects = useProjects();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "linear assignment trigger remove",
    reportFailure: true,
  });
  const [pending, setPending] = useState(false);
  if (rules.length === 0) return null;

  function remove(rule: LinearAssignmentTrigger) {
    Dialog.confirm({
      title: gt("Remove rule?"),
      message: gt("Newly assigned issues stop starting threads for this rule."),
      confirmText: gt("Remove"),
      destructive: true,
      onConfirm: () => {
        setPending(true);
        void updateSettings({
          environmentId,
          input: {
            patch: { linearAssignmentTriggers: rules.filter((entry) => entry.id !== rule.id) },
          },
        }).finally(() => setPending(false));
      },
    });
  }

  return (
    <>
      <View className="gap-1 border-t border-border-subtle p-4">
        <Text className="text-sm font-t3-medium text-foreground">
          <T>Start threads from assignments</T>
        </Text>
        <Text className="text-sm text-foreground-muted">
          {props.connected
            ? gt(
                "Issues newly assigned to you start a thread. Add or edit rules in desktop or web settings.",
              )
            : gt("Paused until Linear is connected.")}
        </Text>
      </View>
      {rules.map((rule) => {
        const project = projects.find(
          (entry) => entry.environmentId === environmentId && entry.id === rule.projectId,
        );
        const label = rule.labelName === null ? "" : ` · ${rule.labelName}`;
        return (
          <SettingsActionRow
            key={rule.id}
            icon="trash"
            tone="danger"
            label={`${gt("Remove {project}", { project: project?.title ?? gt("missing project") })}${label}`}
            disabled={pending || !canOperate}
            onPress={() => remove(rule)}
          />
        );
      })}
    </>
  );
}
