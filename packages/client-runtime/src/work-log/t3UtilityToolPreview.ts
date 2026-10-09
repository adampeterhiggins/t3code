import type { PreviewRecord, ThreadActionToolPreview, ToolPreview } from "./toolPreview.ts";
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
    case "orchestrator_capabilities": {
      const providers = Array.isArray(data?.providers) ? data.providers.filter(isRecord) : [];
      if (!data) return null;
      return records(
        providers.map((provider, index) => {
          const models = Array.isArray(provider.models) ? provider.models.filter(isRecord) : [];
          return record({
            key: str(provider.providerInstanceId) ?? String(index),
            title: str(provider.displayName) ?? str(provider.providerInstanceId) ?? "Provider",
            subtitle: provider.canRunChildTask === false ? "no child tasks" : null,
            meta: present([
              str(provider.driverKind),
              `${models.length} model${models.length === 1 ? "" : "s"}`,
            ]),
            body:
              models
                .map((model) => str(model.label) ?? str(model.id))
                .filter(Boolean)
                .slice(0, 8)
                .join(", ") || null,
          });
        }),
        {
          summary:
            present([
              str(data.inheritedModel),
              str(data.runtimeMode),
              str(data.interactionMode),
            ]).join(" · ") || null,
        },
      );
    }
    case "run_scheduled_task_now":
      return action("Ran a scheduled task now", {
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
