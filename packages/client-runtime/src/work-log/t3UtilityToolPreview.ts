import type {
  PreviewRecord,
  ProviderCapabilitiesToolPreview,
  ProviderCapability,
  ThreadActionToolPreview,
  ToolPreview,
} from "./toolPreview.ts";
import {
  documentPreview,
  firstLine,
  humanKey,
  isRecord,
  properties,
  records,
  scalarText,
  str,
  type Record_,
} from "./previewBuilders.ts";

function action(
  headline: string,
  fields: {
    readonly status?: string | null;
    readonly details?: ReadonlyArray<string | null>;
    readonly threadId?: string | null;
  } = {},
): ThreadActionToolPreview {
  return {
    kind: "thread-action",
    headline,
    status: fields.status ?? null,
    details: (fields.details ?? []).filter((detail): detail is string => Boolean(detail)),
    threadId: fields.threadId ?? null,
  };
}

function record(
  fields: Partial<PreviewRecord> & { readonly key: string; readonly title: string },
): PreviewRecord {
  return { subtitle: null, meta: [], url: null, body: null, threadId: null, ...fields };
}

function present(values: ReadonlyArray<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

function rows(pairs: ReadonlyArray<readonly [string, unknown]>): Array<readonly [string, string]> {
  return pairs.flatMap(([key, value]) => {
    const text = scalarText(value);
    return text ? [[key, text] as const] : [];
  });
}

function projectCard(project: Record_): ToolPreview {
  const scripts = Array.isArray(project.scripts) ? project.scripts.filter(isRecord) : [];
  const model = isRecord(project.defaultModelSelection)
    ? str(project.defaultModelSelection.model)
    : null;
  return properties(
    rows([
      ["Root", project.workspaceRoot],
      ["Default model", model],
      ["New threads", project.defaultThreadEnvMode],
      [
        "Scripts",
        scripts
          .map((script) => str(script.name))
          .filter(Boolean)
          .join(", ") || null,
      ],
      ["Deleted", str(project.deletedAt) ? "yes" : null],
    ]),
    { title: str(project.title) ?? "Project", notes: [str(project.commitError)] },
  );
}

const LINK_SOURCES: Record<string, string> = {
  linear: "Linear",
  github: "GitHub",
  slack: "Slack",
  discord: "Discord",
  notion: "Notion",
  granola: "Granola",
};

/** A thread's linked issue, message, page or note, opening where it came from. */
function threadLinkRecord(source: string, link: Record_): PreviewRecord {
  const number = typeof link.number === "number" ? `#${link.number}` : null;
  const id = str(link.identifier) ?? (number ? `${str(link.repository) ?? ""}${number}` : null);
  return record({
    key: source,
    title: present([id, str(link.title)]).join(" ") || (LINK_SOURCES[source] ?? source),
    subtitle: LINK_SOURCES[source] ?? null,
    meta: present([str(link.channelLabel), str(link.authorName)]),
    url: str(link.url),
  });
}

// The card names a few models per provider; the count says how many there are.
const MAX_CAPABILITY_MODELS = 4;

function capabilitiesPreview(data: Record_): ProviderCapabilitiesToolPreview {
  const inheritedId = str(data.inheritedProviderInstanceId);
  const inheritedModel = str(data.inheritedModel);
  const rawProviders = Array.isArray(data.providers) ? data.providers.filter(isRecord) : [];
  const inheritedModelLabel = rawProviders
    .filter((provider) => str(provider.providerInstanceId) === inheritedId)
    .flatMap((provider) => (Array.isArray(provider.models) ? provider.models.filter(isRecord) : []))
    .find((model) => str(model.id) === inheritedModel)?.label;
  const providers = rawProviders.map((provider, index): ProviderCapability => {
    const id = str(provider.providerInstanceId) ?? String(index);
    const driver = str(provider.driverKind);
    const models = (Array.isArray(provider.models) ? provider.models.filter(isRecord) : [])
      .map((model) => str(model.label) ?? str(model.id))
      .filter((label): label is string => label !== null);
    const constraints = Array.isArray(provider.constraints)
      ? provider.constraints.filter((constraint): constraint is string => Boolean(str(constraint)))
      : [];
    return {
      key: id,
      name: str(provider.displayName) ?? id,
      // A default instance is keyed by its driver, so the driver only adds news for custom ones.
      driver: driver && driver !== id ? driver : null,
      models: models.slice(0, MAX_CAPABILITY_MODELS),
      modelCount: models.length,
      current: id === inheritedId,
      unavailableReason:
        provider.canRunChildTask === false
          ? constraints.join(" ") || "Can't run child tasks."
          : null,
    };
  });
  return {
    kind: "provider-capabilities",
    inheritedModel: str(inheritedModelLabel) ?? inheritedModel,
    inheritedProvider: providers.find((provider) => provider.current)?.name ?? null,
    modes: present([str(data.runtimeMode), str(data.interactionMode)]).map((mode) =>
      mode.replaceAll("-", " "),
    ),
    providers,
  };
}

const QUEUE_ACTIONS: Readonly<Record<string, string>> = {
  t3_queue_edit: "Edited a queued message",
  t3_queue_cancel: "Cancelled a queued message",
  t3_queue_reorder: "Reordered the queue",
  t3_queue_promote_to_steer: "Sent a queued message into the running turn",
};

/** T3 tools outside thread, task, PR, browser and schedule cards. */
export function t3UtilityToolPreview(
  tool: string,
  input: Record_,
  result: unknown,
): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  switch (tool) {
    case "orchestrator_capabilities":
      return data ? capabilitiesPreview(data) : null;
    case "run_scheduled_task_now":
      // The run starts after the call returns, so its outcome is not known yet.
      return action("Scheduled run requested", {
        status: str(data?.lastRunStatus),
        details: [typeof data?.runCount === "number" ? `Run ${data.runCount}` : null],
        threadId: str(data?.threadId),
      });
    case "delete_scheduled_task":
      return action(
        data?.deleted === false ? "Scheduled task not deleted" : "Deleted a scheduled task",
        {
          status: data?.deleted === false ? "failed" : "completed",
        },
      );
    case "request_secret": {
      const outcome = str(data?.status);
      return action(`Asked for “${str(input.label) ?? "a secret"}”`, {
        status: outcome === "saved" ? "completed" : outcome,
        details: [str(input.reason)],
      });
    }
    case "t3_approval_respond":
      return action(
        `Answered an approval: ${humanKey(str(input.decision) ?? "responded").toLowerCase()}`,
        {
          threadId: str(input.threadId),
        },
      );
    case "t3_workflow_stop":
      return action("Stop requested", { threadId: str(input.threadId) });
    case "t3_thread_delete":
      return action(
        data && typeof data.sequence === "number"
          ? "Deleted a thread"
          : "Requested a thread deletion",
      );
    case "t3_draft_list": {
      const drafts = Array.isArray(data?.drafts) ? data.drafts.filter(isRecord) : [];
      return records(
        drafts.map((draft, index) => {
          const text = str(draft.text) ?? "Empty draft";
          const title = firstLine(text);
          return record({
            key: str(draft.id) ?? String(index),
            title,
            body: text === title ? null : text,
            threadId: str(draft.threadId),
          });
        }),
        { summary: `${drafts.length} draft${drafts.length === 1 ? "" : "s"}` },
      );
    }
    case "t3_draft_create":
      return documentPreview(str(data?.text) ?? str(input.text) ?? "", { title: "Saved a draft" });
    case "t3_draft_send":
      return action("Sent a draft", { threadId: str(data?.threadId) ?? str(input.threadId) });
    case "t3_draft_delete":
      return action("Deleted a draft", { threadId: str(input.threadId) });
    case "t3_queue_list": {
      const items = Array.isArray(data?.items) ? data.items.filter(isRecord) : [];
      return records(
        items.map((item, index) => {
          const text = str(item.text) ?? "Queued message";
          const title = firstLine(text);
          // Only a message longer than its first line needs the rest below it.
          return record({
            key: str(item.queuedRunId) ?? String(index),
            title,
            body: text.trim() === title ? null : text,
          });
        }),
        { summary: `${items.length} queued` },
      );
    }
    case "t3_queue_read":
      return data ? documentPreview(str(data.text) ?? "", { title: "Queued message" }) : null;
    case "t3_queue_edit":
    case "t3_queue_cancel":
    case "t3_queue_reorder":
    case "t3_queue_promote_to_steer":
      return tool === "t3_queue_edit" && str(input.text)
        ? documentPreview(str(input.text) ?? "", { summary: QUEUE_ACTIONS[tool] ?? null })
        : action(QUEUE_ACTIONS[tool] ?? "Updated the queue", { threadId: str(input.threadId) });
    case "t3_pending_request_list": {
      const ids = Array.isArray(data?.requestIds)
        ? data.requestIds.filter((id) => typeof id === "string")
        : [];
      return action(
        ids.length === 0
          ? "No pending requests"
          : `${ids.length} pending request${ids.length === 1 ? "" : "s"}`,
        {
          threadId: str(input.threadId),
        },
      );
    }
    case "t3_pending_request_read": {
      const questions = Array.isArray(data?.questions) ? data.questions.filter(isRecord) : [];
      return {
        kind: "questions",
        questions: questions.flatMap((question) => {
          const text = str(question.question);
          if (!text) return [];
          const options = Array.isArray(question.options) ? question.options.filter(isRecord) : [];
          return [
            {
              question: text,
              options: options.flatMap((option) => {
                const label = str(option.label);
                return label ? [{ label, selected: false }] : [];
              }),
              otherAnswer: null,
            },
          ];
        }),
      };
    }
    case "t3_pending_request_respond": {
      const answers = isRecord(input.answers) ? input.answers : {};
      return action("Answered a pending request", {
        details: Object.values(answers).map(
          (answer) => scalarText(answer) ?? (Array.isArray(answer) ? answer.join(", ") : null),
        ),
        threadId: str(input.threadId),
      });
    }
    case "t3_attachment_prepare_upload": {
      const upload = isRecord(input.upload) ? input.upload : {};
      return action(`Prepared an upload: ${str(upload.name) ?? "file"}`, {
        details: [
          str(upload.mimeType),
          typeof upload.sizeBytes === "number" ? `${Math.round(upload.sizeBytes / 1024)} KB` : null,
        ],
      });
    }
    case "t3_attachment_discard":
      return action("Discarded an attachment");
    case "device_list": {
      const devices = Array.isArray(data?.devices) ? data.devices.filter(isRecord) : [];
      const open = Array.isArray(data?.open) ? data.open.filter(isRecord) : [];
      return records(
        devices.map((device, index) =>
          record({
            key: `${str(device.hostId) ?? ""}:${str(device.id) ?? index}`,
            title: str(device.name) ?? "Device",
            subtitle: open.some((entry) => entry.deviceId === device.id)
              ? "open"
              : device.booted === true
                ? "booted"
                : null,
            meta: present([
              str(device.platform),
              str(device.version),
              device.physical === true ? "physical" : null,
            ]),
          }),
        ),
      );
    }
    case "device_open":
    case "device_screenshot": {
      const device = isRecord(data?.device) ? data.device : null;
      const screenshot = isRecord(data?.screenshot) ? data.screenshot : null;
      return action(
        `${tool === "device_open" ? "Opened" : "Captured"} ${str(device?.name) ?? "a device"}`,
        {
          details: [
            present([str(device?.platform), str(device?.version)]).join(" ") || null,
            screenshot ? `${String(screenshot.width)}×${String(screenshot.height)}` : null,
          ],
        },
      );
    }
    case "device_close":
      return action(input.shutdown === true ? "Shut down the device" : "Closed the device");
    case "t3_environment_read":
    case "t3_environment_preferences_update": {
      const prefs =
        tool === "t3_environment_read"
          ? isRecord(data?.preferences)
            ? data.preferences
            : {}
          : (data ?? {});
      const activity = isRecord(prefs.backgroundActivity) ? prefs.backgroundActivity : {};
      const writing = isRecord(prefs.sourceControlWritingStyle)
        ? prefs.sourceControlWritingStyle
        : {};
      const platform = isRecord(data?.platform) ? data.platform : {};
      return properties(
        rows([
          ["Server version", data?.serverVersion],
          ["Platform", present([str(platform.os), str(platform.arch)]).join(" ") || null],
          ["New threads", prefs.defaultThreadEnvMode],
          ["Worktrees start from origin", prefs.newWorktreesStartFromOrigin],
          ["Background activity", activity.profile],
          ["Writing style", writing.mode],
          ["Python", prefs.pythonInterpreterPath],
        ]),
        {
          title:
            tool === "t3_environment_read"
              ? (str(data?.label) ?? "Environment")
              : "Updated preferences",
        },
      );
    }
    case "t3_preview_list": {
      const sessions = Array.isArray(data?.sessions) ? data.sessions.filter(isRecord) : [];
      return records(
        sessions.map((session, index) => {
          const nav = isRecord(session.navStatus) ? session.navStatus : {};
          return record({
            key: str(session.tabId) ?? String(index),
            title: str(nav.title) ?? str(nav.url) ?? "Preview tab",
            subtitle:
              str(nav._tag) === "LoadFailed"
                ? "failed"
                : str(nav._tag) === "Loading"
                  ? "loading"
                  : null,
            meta: present([str(nav.url)]),
            threadId: str(session.threadId),
          });
        }),
      );
    }
    case "t3_preview_close":
      return action("Closed a preview tab");
    case "t3_project_list": {
      const projects = Array.isArray(data?.projects) ? data.projects.filter(isRecord) : [];
      return records(
        projects.map((project, index) =>
          record({
            key: str(project.id) ?? String(index),
            title: str(project.title) ?? "Project",
            meta: present([
              isRecord(project.defaultModelSelection)
                ? str(project.defaultModelSelection.model)
                : null,
            ]),
            body: str(project.workspaceRoot),
          }),
        ),
      );
    }
    case "t3_project_read":
    case "t3_project_create":
    case "t3_project_update":
    case "t3_project_delete":
      return data ? projectCard(data) : null;
    case "t3_project_clone": {
      const repository = isRecord(data?.repository) ? data.repository : null;
      return action(
        `Cloned ${str(repository?.nameWithOwner) ?? str(input.repository) ?? "a repository"}`,
        {
          details: [str(data?.cwd), str(data?.remoteUrl)],
        },
      );
    }
    case "t3_worktree_handoff": {
      const setup = isRecord(data?.setupScript) ? data.setupScript : {};
      const continuation = isRecord(data?.continuation) ? data.continuation : {};
      return action(
        `${data?.created === true ? "Created" : "Moved to"} worktree ${str(data?.branch) ?? str(input.branch) ?? ""}`.trim(),
        {
          details: [
            str(data?.worktreePath),
            str(data?.baseRef) ? `from ${str(data?.baseRef)}` : null,
            str(setup.status) === "started"
              ? `Setup: ${str(setup.scriptName) ?? "running"}`
              : str(setup.status) === "failed"
                ? `Setup failed: ${str(setup.detail) ?? ""}`
                : null,
            str(continuation.status) === "scheduled"
              ? `Continuing (${str(continuation.delivery) ?? "scheduled"})`
              : null,
          ],
        },
      );
    }
    case "t3_worktree_status":
      return data
        ? action(
            data.attached === true
              ? `On worktree ${str(data.branch) ?? ""}`.trim()
              : "In the project root",
            {
              details: [str(data.worktreePath) ?? str(data.projectWorkspaceRoot)],
            },
          )
        : null;
    case "link_linear_issue":
    case "link_github_issue": {
      const link = isRecord(data?.link) ? data.link : null;
      if (!link) return null;
      return records([threadLinkRecord(tool === "link_linear_issue" ? "linear" : "github", link)], {
        notes: [str(data?.replacedUrl) ? `Replaced ${str(data?.replacedUrl)}` : null],
      });
    }
    case "unlink_linear_issue":
    case "unlink_github_issue":
      return typeof data?.wasLinked === "boolean"
        ? action(data.wasLinked ? "Unlinked the issue" : "No issue was linked")
        : null;
    case "list_thread_links":
      return data
        ? records(
            Object.keys(LINK_SOURCES).flatMap((source) => {
              const link = data[source];
              return isRecord(link) ? [threadLinkRecord(source, link)] : [];
            }),
          )
        : null;
    case "t3_worktree_list": {
      const refs = Array.isArray(data?.refs) ? data.refs.filter(isRecord) : [];
      return records(
        refs.map((ref, index) =>
          record({
            key: str(ref.name) ?? String(index),
            title: str(ref.name) ?? "Branch",
            subtitle: ref.current === true ? "current" : ref.isDefault === true ? "default" : null,
            meta: present([ref.isRemote === true ? (str(ref.remoteName) ?? "remote") : null]),
            body: str(ref.worktreePath),
          }),
        ),
        { notes: [typeof data?.totalCount === "number" ? `${data.totalCount} branches` : null] },
      );
    }
    default:
      return null;
  }
}
