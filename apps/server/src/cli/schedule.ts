import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ProviderInstanceId,
  ScheduledTaskWebhookDeliveryId,
  ThreadId,
  WS_METHODS,
  isProviderAvailable,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ScheduledTask,
  type ScheduledTaskSchedule,
  type ScheduledTaskUpsertInput,
  type ScheduledTaskUpsertSchedule,
  type ServerProvider,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";

import {
  LiveUsageError,
  LiveRpcFailedError,
  formatLocalMinute,
  jsonFlag,
  liveLocationFlags,
  loadLiveShell,
  matchId,
  printJson,
  reportLiveErrors,
  resolveLiveProject,
  rpc,
  withLiveRpc,
  loadLiveSettings,
  type LiveRpcClient,
} from "./liveRpc.ts";

const TITLE_MAX_CHARS = 80;
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MINUTE_MS = 60_000;
const DURATION_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: MINUTE_MS,
  h: 3_600_000,
  d: 86_400_000,
};

const usage = (detail: string) => new LiveUsageError({ detail });

/** `90m`, `1h30m`, `2d`, or a bare number of minutes. */
export const parseEvery = (text: string) => {
  const value = text.trim().toLowerCase();
  let everyMs: number;
  if (/^\d+$/.test(value)) {
    everyMs = Number(value) * MINUTE_MS;
  } else if (/^(\d+[smhd])+$/.test(value)) {
    everyMs = 0;
    for (const [, amount, unit] of value.matchAll(/(\d+)([smhd])/g)) {
      everyMs += Number(amount) * (DURATION_UNIT_MS[unit ?? ""] ?? 0);
    }
  } else {
    return Effect.fail(usage(`'${text}' is not a duration. Use a form like 15m, 1h, or 1h30m.`));
  }
  if (!Number.isSafeInteger(everyMs) || everyMs < MIN_SCHEDULED_TASK_INTERVAL_MS) {
    return Effect.fail(usage("--every must be at least one minute."));
  }
  return Effect.succeed(everyMs);
};

/**
 * Day numbers (0 is Sunday), short names, or `weekdays`/`weekends`/`daily`.
 * `undefined` means every day, which the schedule stores as no weekdays.
 */
export const parseWeekdays = Effect.fn("parseWeekdays")(function* (text: string) {
  const value = text.trim().toLowerCase();
  if (value === "daily" || value === "all" || value === "every") {
    return undefined;
  }
  if (value === "weekdays") return yield* Effect.succeed([1, 2, 3, 4, 5]);
  if (value === "weekends") return yield* Effect.succeed([0, 6]);
  const days = new Set<number>();
  for (const part of value.split(",")) {
    const token = part.trim();
    const byName = WEEKDAY_NAMES.findIndex((name) => token.startsWith(name));
    const day = /^[0-6]$/.test(token) ? Number(token) : byName;
    if (day < 0) {
      return yield* usage(`'${part.trim()}' is not a weekday. Use 0-6 (0 is Sunday) or mon,tue,…`);
    }
    days.add(day);
  }
  const sorted = [...days].toSorted((left, right) => left - right);
  return yield* Effect.succeed(sorted.length === 7 ? undefined : sorted);
});

const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface ScheduleFlags {
  readonly every: Option.Option<string>;
  readonly at: Option.Option<string>;
  readonly weekdays: Option.Option<string>;
  readonly catchUp: Option.Option<boolean>;
  readonly webhook: boolean;
}

/**
 * The trigger the flags describe, or none when they leave it unchanged.
 * Weekday and catch-up flags alone adjust an existing fixed-time trigger.
 */
export const scheduleFromFlags = Effect.fn("cli.schedule.scheduleFromFlags")(function* (
  flags: ScheduleFlags,
  existing: ScheduledTaskSchedule | undefined,
) {
  const kinds = [Option.isSome(flags.every), Option.isSome(flags.at), flags.webhook].filter(
    Boolean,
  ).length;
  if (kinds > 1) {
    return yield* usage("Pass only one of --every, --at, or --webhook.");
  }
  const adjustsFixedTime = Option.isSome(flags.weekdays) || Option.isSome(flags.catchUp);
  if (Option.isSome(flags.every)) {
    if (adjustsFixedTime) return yield* usage("--weekdays and --catch-up go with --at.");
    const everyMs = yield* parseEvery(flags.every.value);
    return Option.some<ScheduledTaskUpsertSchedule>({ type: "interval", everyMs });
  }
  if (flags.webhook) {
    if (adjustsFixedTime) return yield* usage("--weekdays and --catch-up go with --at.");
    // Re-sending the stored signature keeps its secret; a fresh webhook has none.
    return Option.some<ScheduledTaskUpsertSchedule>(
      existing?.type === "webhook"
        ? existing
        : { type: "webhook", signature: null, maxDeliveryAgeMinutes: null },
    );
  }
  const base = Option.isSome(flags.at)
    ? Option.some(flags.at.value.trim())
    : existing?.type === "fixed_time" && adjustsFixedTime
      ? Option.some(existing.timeOfDay)
      : Option.none<string>();
  if (Option.isNone(base)) {
    if (adjustsFixedTime) {
      return yield* usage("--weekdays and --catch-up need --at, or a task that runs at a time.");
    }
    return Option.none<ScheduledTaskUpsertSchedule>();
  }
  if (!TIME_OF_DAY.test(base.value)) {
    return yield* usage(`'${base.value}' is not a time. Use 24-hour HH:MM, such as 09:30.`);
  }
  const previous = existing?.type === "fixed_time" ? existing : undefined;
  const weekdays = Option.isSome(flags.weekdays)
    ? yield* parseWeekdays(flags.weekdays.value)
    : previous?.weekdays;
  const catchUpMissed = Option.getOrUndefined(flags.catchUp) ?? previous?.catchUpMissed;
  return Option.some<ScheduledTaskUpsertSchedule>({
    type: "fixed_time",
    timeOfDay: base.value,
    ...(weekdays === undefined || weekdays.length === 0 ? {} : { weekdays }),
    ...(catchUpMissed === undefined ? {} : { catchUpMissed }),
  });
});

export const describeSchedule = (schedule: ScheduledTaskSchedule): string => {
  if (schedule.type === "webhook") {
    return schedule.signature === null ? "On webhook" : "On signed webhook";
  }
  if (schedule.type === "interval") {
    return `Every ${formatDuration(schedule.everyMs)}`;
  }
  const weekdays = schedule.weekdays ?? [];
  const days =
    weekdays.length === 0
      ? "Daily"
      : weekdays.length === 5 && weekdays.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : weekdays.map((day) => WEEKDAY_LABELS[day] ?? String(day)).join(", ");
  const catchUp = schedule.catchUpMissed === true ? ", catches up" : "";
  return `${days} at ${schedule.timeOfDay}${catchUp}`;
};

/** A local timestamp with how far away it is, such as `2026-10-21 09:00 (in 2h 5m)`. */
const formatWhen = (iso: string | null, now: number): string => {
  if (iso === null) return "-";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const local = formatLocalMinute(iso);
  const distance = formatDuration(Math.abs(at - now));
  return `${local} (${at >= now ? `in ${distance}` : `${distance} ago`})`;
};

const titleFromPrompt = (prompt: string) => {
  const firstLine = prompt.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length === 0) return "Scheduled task";
  return firstLine.length > TITLE_MAX_CHARS
    ? `${firstLine.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`
    : firstLine;
};

const readPrompt = Effect.fn("cli.schedule.readPrompt")(function* (argument: string) {
  const text =
    argument === "-"
      ? yield* Stdio.Stdio.pipe(
          Effect.flatMap((stdio) => stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)),
        )
      : argument;
  if (text.trim().length === 0) return yield* usage("The prompt is empty.");
  return text.trim();
});

const listTasks = (client: LiveRpcClient) =>
  rpc(client[WS_METHODS.scheduledTasksSubscribe]({}).pipe(Stream.runHead)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new LiveRpcFailedError({ detail: "The server sent no scheduled task snapshot." }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

const findTask = Effect.fn("cli.schedule.findTask")(function* (
  client: LiveRpcClient,
  identifier: string,
) {
  const { tasks } = yield* listTasks(client);
  const match = matchId(tasks, (task) => task.id, identifier);
  if (match.type === "none") return yield* usage(`No scheduled task matches '${identifier}'.`);
  if (match.type === "ambiguous") {
    return yield* usage(`'${identifier}' matches several tasks: ${match.ids.join(", ")}.`);
  }
  return { task: match.item };
});

const decodeThreadId = (value: string) => ThreadId.make(value.trim());

const webhookLine = (task: ScheduledTask) =>
  task.webhook === undefined
    ? null
    : (task.webhook.url ??
      `${task.webhook.path} (no public URL: enable T3 Connect remote access to receive webhooks)`);

const printTask = Effect.fn("cli.schedule.printTask")(function* (
  task: ScheduledTask,
  context: { readonly projectTitle: string | undefined },
) {
  const now = yield* Clock.currentTimeMillis;
  yield* Console.log(task.title);
  yield* Console.log(`  id         ${task.id}`);
  yield* Console.log(`  enabled    ${task.enabled ? "yes" : "no"}`);
  yield* Console.log(`  schedule   ${describeSchedule(task.schedule)}`);
  if (task.schedule.type !== "webhook") {
    yield* Console.log(`  next run   ${task.enabled ? formatWhen(task.nextRunAt, now) : "paused"}`);
  }
  const webhook = webhookLine(task);
  if (webhook !== null) yield* Console.log(`  webhook    ${webhook}`);
  yield* Console.log(`  project    ${context.projectTitle ?? task.projectId}`);
  yield* Console.log(
    `  runs in    ${task.threadId === null ? workspaceLabel(task.workspaceStrategy) : `thread ${task.threadId}`}`,
  );
  yield* Console.log(`  model      ${task.modelSelection.instanceId}/${task.modelSelection.model}`);
  yield* Console.log(
    `  last run   ${formatWhen(task.lastRunAt, now)}  ${task.lastRunStatus}  (${task.runCount} total)`,
  );
  if (task.lastRunError !== null) yield* Console.log(`  last error ${task.lastRunError}`);
  yield* Console.log(`\n${task.prompt}`);
});

const workspaceLabel = (strategy: OrchestrationV2ThreadLaunchWorkspaceStrategy) => {
  switch (strategy.type) {
    case "root":
      return "a new thread in the project checkout";
    case "existing_worktree":
      return `a new thread in ${strategy.worktreePath}`;
    case "worktree":
      return `a new thread in a new worktree from ${strategy.startFromOrigin === false ? "" : "origin/"}${strategy.baseRef}`;
  }
};

const idArgument = Argument.String("id").pipe(
  Argument.withDescription("Scheduled task id, or a unique part of it."),
);

const projectFlag = Flag.String("project").pipe(
  Flag.withDescription("Project id or a path inside the project. Defaults to this directory."),
);

const scheduleFlags = {
  every: Flag.String("every").pipe(
    Flag.withDescription("Run repeatedly, such as 15m, 1h, or 1h30m (at least 1m)."),
    Flag.optional,
  ),
  at: Flag.String("at").pipe(
    Flag.withDescription("Run at this local time on the server, in 24-hour HH:MM."),
    Flag.optional,
  ),
  weekdays: Flag.String("weekdays").pipe(
    Flag.withDescription(
      "Days for --at: 1,2,3 (0 is Sunday), mon,wed, weekdays, weekends, or daily.",
    ),
    Flag.optional,
  ),
  catchUp: Flag.Boolean("catch-up").pipe(
    Flag.withDescription(
      "With --at, run a missed occurrence once the server is awake again the same day.",
    ),
    Flag.optional,
  ),
  webhook: Flag.Boolean("webhook").pipe(
    Flag.withDescription("Run on each request to the task's webhook URL."),
    Flag.withDefault(false),
  ),
  title: Flag.String("title").pipe(
    Flag.withDescription("Task title. Defaults to the prompt's first line."),
    Flag.optional,
  ),
  provider: Flag.String("provider").pipe(
    Flag.withDescription("Provider instance id. Pass with --model."),
    Flag.optional,
  ),
  model: Flag.String("model").pipe(
    Flag.withDescription("Model slug. Defaults to the project's default model."),
    Flag.optional,
  ),
  thread: Flag.String("thread").pipe(
    Flag.withDescription(
      "Post each run into this thread id instead of starting a new thread. 'none' starts a new thread per run.",
    ),
    Flag.optional,
  ),
  baseRef: Flag.String("base-ref").pipe(
    Flag.withDescription("Start each run's new worktree from this ref on origin (default main)."),
    Flag.optional,
  ),
  checkout: Flag.Boolean("checkout").pipe(
    Flag.withDescription("Run new threads in the project checkout instead of a new worktree."),
    Flag.optional,
  ),
};

const modelSelectionFromFlags = (flags: {
  readonly provider: Option.Option<string>;
  readonly model: Option.Option<string>;
}) => {
  if (Option.isSome(flags.provider) !== Option.isSome(flags.model)) {
    return Effect.fail(usage("--provider and --model go together."));
  }
  return Effect.succeed(
    Option.isSome(flags.provider) && Option.isSome(flags.model)
      ? Option.some<ModelSelection>({
          instanceId: ProviderInstanceId.make(flags.provider.value.trim()),
          model: flags.model.value.trim(),
        })
      : Option.none<ModelSelection>(),
  );
};

/**
 * The settings form's last resort when neither the project nor the settings
 * name a model: a signed-in provider's default model, else its first.
 */
const defaultModelFromProviders = (
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null => {
  const models = providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        isProviderAvailable(provider) &&
        provider.auth.status !== "unauthenticated",
    )
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.isLegacy !== true)
        .map((model) => ({ instanceId: provider.instanceId, model })),
    );
  const pick = models.find(({ model }) => model.isDefault === true) ?? models[0];
  return pick === undefined ? null : { instanceId: pick.instanceId, model: pick.model.slug };
};

/**
 * A run bound to a thread happens in that thread's own checkout, so the
 * strategy only matters for unbound tasks, matching the MCP schedule tool.
 */
export const workspaceStrategyFromFlags = (
  flags: { readonly baseRef: Option.Option<string>; readonly checkout: Option.Option<boolean> },
  boundToThread: boolean,
  existing: OrchestrationV2ThreadLaunchWorkspaceStrategy | undefined,
): OrchestrationV2ThreadLaunchWorkspaceStrategy => {
  if (boundToThread) return { type: "root" };
  if (Option.getOrUndefined(flags.checkout) === true) return { type: "root" };
  if (Option.isSome(flags.baseRef) || Option.getOrUndefined(flags.checkout) === false) {
    return {
      type: "worktree",
      baseRef: Option.getOrElse(flags.baseRef, () => "main").trim() || "main",
      startFromOrigin: true,
    };
  }
  return existing ?? { type: "worktree", baseRef: "main", startFromOrigin: true };
};

const threadFromFlag = (thread: Option.Option<string>) =>
  Option.map(thread, (value) =>
    value.trim().toLowerCase() === "none" ? null : decodeThreadId(value),
  );

const scheduleListCommand = Command.make("list", {
  ...liveLocationFlags,
  project: projectFlag.pipe(Flag.optional),
  json: jsonFlag,
}).pipe(
  Command.withDescription("List scheduled tasks with their next run."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.list")(function* (client) {
        const { tasks } = yield* listTasks(client);
        const { projects } = yield* loadLiveShell(client);
        const projectId = Option.isSome(flags.project)
          ? Option.some((yield* resolveLiveProject(projects, flags.project.value)).id)
          : Option.none();
        const shown = Option.isSome(projectId)
          ? tasks.filter((task) => task.projectId === projectId.value)
          : tasks;
        if (flags.json) return yield* printJson({ tasks: shown });
        if (shown.length === 0) return yield* Console.log("No scheduled tasks.");
        const now = yield* Clock.currentTimeMillis;
        const titles = new Map(projects.map((project) => [project.id, project.title]));
        for (const task of shown) {
          const when =
            task.schedule.type === "webhook"
              ? (webhookLine(task) ?? "")
              : task.enabled
                ? `next ${formatWhen(task.nextRunAt, now)}`
                : "paused";
          yield* Console.log(
            [
              task.id,
              task.enabled ? "on " : "off",
              describeSchedule(task.schedule),
              titles.get(task.projectId) ?? task.projectId,
              task.title,
              when,
            ].join("  "),
          );
        }
      }),
    ),
  ),
);

const scheduleShowCommand = Command.make("show", {
  ...liveLocationFlags,
  id: idArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show a scheduled task, its prompt, next run, and webhook URL."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.show")(function* (client) {
        const { task } = yield* findTask(client, flags.id);
        if (flags.json) return yield* printJson(task);
        const { projects } = yield* loadLiveShell(client);
        yield* printTask(task, {
          projectTitle: projects.find((project) => project.id === task.projectId)?.title,
        });
      }),
    ),
  ),
);

const printSaved = Effect.fn("cli.schedule.printSaved")(function* (
  task: ScheduledTask,
  json: boolean,
) {
  if (json) return yield* printJson(task);
  yield* Console.log(task.id);
  if (task.schedule.type !== "webhook" && task.enabled) {
    yield* Console.log(`Next run ${formatWhen(task.nextRunAt, yield* Clock.currentTimeMillis)}`);
  }
  const webhook = webhookLine(task);
  if (webhook !== null) yield* Console.log(`Webhook ${webhook}`);
});

const scheduleCreateCommand = Command.make("create", {
  ...liveLocationFlags,
  prompt: Argument.String("prompt").pipe(
    Argument.withDescription("Prompt for each run, or - to read it from stdin."),
  ),
  project: projectFlag.pipe(Flag.withDefault(".")),
  ...scheduleFlags,
  disabled: Flag.Boolean("disabled").pipe(
    Flag.withDescription("Save the task paused."),
    Flag.withDefault(false),
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Schedule a prompt with --every, --at, or --webhook. Each run starts a thread unless --thread is set.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { prompt, schedule, flagModel } = yield* Effect.gen(function* () {
        const prompt = yield* readPrompt(flags.prompt);
        const schedule = yield* scheduleFromFlags(flags, undefined);
        if (Option.isNone(schedule)) {
          return yield* usage("Pass --every, --at, or --webhook.");
        }
        return { prompt, schedule, flagModel: yield* modelSelectionFromFlags(flags) };
      }).pipe(reportLiveErrors);
      const threadId = Option.getOrElse(threadFromFlag(flags.thread), () => null);
      yield* withLiveRpc(
        flags,
        "t3 schedule cli",
        Effect.fn("cli.schedule.create")(function* (client) {
          const { projects } = yield* loadLiveShell(client);
          const project = yield* resolveLiveProject(projects, flags.project);
          const modelSelection = Option.isSome(flagModel)
            ? flagModel.value
            : (project.defaultModelSelection ??
              (yield* loadLiveSettings(client)).defaultModelSelection ??
              defaultModelFromProviders(
                (yield* rpc(client[WS_METHODS.serverGetConfig]({}))).providers,
              ));
          if (modelSelection === null) {
            return yield* usage("No signed-in provider has a model. Pass --provider and --model.");
          }
          const input: ScheduledTaskUpsertInput = {
            title: Option.getOrElse(flags.title, () => titleFromPrompt(prompt)),
            prompt,
            enabled: !flags.disabled,
            schedule: schedule.value,
            projectId: project.id,
            threadId,
            workspaceStrategy: workspaceStrategyFromFlags(flags, threadId !== null, undefined),
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
          };
          const { task } = yield* rpc(client[WS_METHODS.scheduledTasksUpsert](input));
          yield* printSaved(task, flags.json);
        }),
      );
    }),
  ),
);

const scheduleUpdateCommand = Command.make("update", {
  ...liveLocationFlags,
  id: idArgument,
  prompt: Flag.String("prompt").pipe(
    Flag.withDescription("New prompt, or - to read it from stdin."),
    Flag.optional,
  ),
  ...scheduleFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Change a scheduled task. Flags you leave out keep their value."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { prompt, flagModel } = yield* Effect.gen(function* () {
        const prompt = Option.isSome(flags.prompt)
          ? Option.some(yield* readPrompt(flags.prompt.value))
          : Option.none<string>();
        return { prompt, flagModel: yield* modelSelectionFromFlags(flags) };
      }).pipe(reportLiveErrors);
      yield* withLiveRpc(
        flags,
        "t3 schedule cli",
        Effect.fn("cli.schedule.update")(function* (client) {
          const { task: existing } = yield* findTask(client, flags.id);
          const schedule = yield* scheduleFromFlags(flags, existing.schedule);
          const threadId = Option.getOrElse(threadFromFlag(flags.thread), () => existing.threadId);
          const rebinds = Option.isSome(flags.thread);
          const touchesWorkspace =
            rebinds || Option.isSome(flags.baseRef) || Option.isSome(flags.checkout);
          const input: ScheduledTaskUpsertInput = {
            id: existing.id,
            requireExisting: true,
            title: Option.getOrElse(flags.title, () => existing.title),
            prompt: Option.getOrElse(prompt, () => existing.prompt),
            enabled: existing.enabled,
            schedule: Option.getOrElse(schedule, () => existing.schedule),
            projectId: existing.projectId,
            threadId,
            workspaceStrategy: touchesWorkspace
              ? workspaceStrategyFromFlags(
                  flags,
                  threadId !== null,
                  // Unbinding must not keep running loose in the bound
                  // thread's root checkout.
                  rebinds ? undefined : existing.workspaceStrategy,
                )
              : existing.workspaceStrategy,
            modelSelection: Option.getOrElse(flagModel, () => existing.modelSelection),
            runtimeMode: existing.runtimeMode,
            interactionMode: existing.interactionMode,
          };
          const { task } = yield* rpc(client[WS_METHODS.scheduledTasksUpsert](input));
          yield* printSaved(task, flags.json);
        }),
      );
    }),
  ),
);

const scheduleDeleteCommand = Command.make("delete", {
  ...liveLocationFlags,
  id: idArgument,
  yes: Flag.Boolean("yes").pipe(
    Flag.withDescription("Confirm the deletion."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Delete a scheduled task. Threads it started are kept."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.delete")(function* (client) {
        const { task } = yield* findTask(client, flags.id);
        if (!flags.yes) {
          return yield* usage(`Pass --yes to delete '${task.title}' (${task.id}).`);
        }
        yield* rpc(client[WS_METHODS.scheduledTasksDelete]({ id: task.id }));
        yield* Console.log(`Deleted ${task.id}.`);
      }),
    ),
  ),
);

const scheduleRunCommand = Command.make("run", {
  ...liveLocationFlags,
  id: idArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Run a scheduled task now and print the thread it ran in."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.run")(function* (client) {
        const { task } = yield* findTask(client, flags.id);
        const result = yield* rpc(client[WS_METHODS.scheduledTasksRunNow]({ id: task.id }));
        if (flags.json) return yield* printJson(result);
        if (result.threadId === undefined || result.threadId === null) {
          return yield* usage(
            `The run did not start${result.task.lastRunError === null ? "." : `: ${result.task.lastRunError}`}`,
          );
        }
        yield* Console.log(result.threadId);
      }),
    ),
  ),
);

const setEnabledCommand = (name: "enable" | "disable") =>
  Command.make(name, { ...liveLocationFlags, id: idArgument, json: jsonFlag }).pipe(
    Command.withDescription(
      name === "enable" ? "Resume a paused scheduled task." : "Pause a scheduled task.",
    ),
    Command.withHandler((flags) =>
      withLiveRpc(
        flags,
        "t3 schedule cli",
        Effect.fn("cli.schedule.setEnabled")(function* (client) {
          const { task: existing } = yield* findTask(client, flags.id);
          const { task } = yield* rpc(
            client[WS_METHODS.scheduledTasksSetEnabled]({
              id: existing.id,
              enabled: name === "enable",
            }),
          );
          if (flags.json) return yield* printJson(task);
          yield* Console.log(`${task.enabled ? "Enabled" : "Disabled"} ${task.id}.`);
          if (task.enabled && task.schedule.type !== "webhook") {
            yield* Console.log(
              `Next run ${formatWhen(task.nextRunAt, yield* Clock.currentTimeMillis)}`,
            );
          }
        }),
      ),
    ),
  );

const requireWebhookTask = Effect.fn("cli.schedule.requireWebhookTask")(function* (
  client: LiveRpcClient,
  identifier: string,
) {
  const { task } = yield* findTask(client, identifier);
  if (task.schedule.type !== "webhook") {
    return yield* usage(`${task.id} runs on a timer, not a webhook.`);
  }
  return task;
});

const webhookRotateCommand = Command.make("rotate", {
  ...liveLocationFlags,
  id: idArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Replace a webhook task's URL. The old URL stops working."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.webhookRotate")(function* (client) {
        const existing = yield* requireWebhookTask(client, flags.id);
        const { task } = yield* rpc(
          client[WS_METHODS.scheduledTasksRotateWebhookToken]({ id: existing.id }),
        );
        if (flags.json) return yield* printJson(task);
        yield* Console.log(webhookLine(task) ?? "The server returned no webhook URL.");
      }),
    ),
  ),
);

const webhookDeliveriesCommand = Command.make("deliveries", {
  ...liveLocationFlags,
  id: idArgument,
  delivery: Argument.String("delivery").pipe(
    Argument.withDescription("Delivery id to show in full, with its headers, body, and prompt."),
    Argument.optional,
  ),
  json: jsonFlag,
}).pipe(
  Command.withDescription("List the requests a webhook task received, newest first."),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 schedule cli",
      Effect.fn("cli.schedule.webhookDeliveries")(function* (client) {
        const task = yield* requireWebhookTask(client, flags.id);
        if (Option.isSome(flags.delivery)) {
          const { delivery } = yield* rpc(
            client[WS_METHODS.scheduledTasksGetWebhookDelivery]({
              id: task.id,
              deliveryId: ScheduledTaskWebhookDeliveryId.make(flags.delivery.value.trim()),
            }),
          );
          if (flags.json) return yield* printJson(delivery);
          yield* Console.log(
            `${delivery.receivedAt}  ${delivery.method}  ${delivery.outcome}${delivery.error === null ? "" : `  ${delivery.error}`}`,
          );
          for (const [name, value] of Object.entries(delivery.headers)) {
            yield* Console.log(`${name}: ${value}`);
          }
          yield* Console.log(`\n${delivery.body}${delivery.bodyTruncated ? "\n[truncated]" : ""}`);
          if (delivery.renderedPrompt !== null) {
            yield* Console.log(`\n[prompt]\n${delivery.renderedPrompt}`);
          }
          return;
        }
        const { deliveries } = yield* rpc(
          client[WS_METHODS.scheduledTasksListWebhookDeliveries]({ id: task.id }),
        );
        if (flags.json) return yield* printJson(deliveries);
        if (deliveries.length === 0) return yield* Console.log("No deliveries yet.");
        for (const delivery of deliveries) {
          const missing =
            delivery.missingFields.length === 0
              ? ""
              : `  missing ${delivery.missingFields.join(", ")}`;
          yield* Console.log(
            [
              delivery.id,
              delivery.receivedAt,
              delivery.method,
              delivery.outcome,
              delivery.signatureVerified ? "signed" : "unsigned",
              `${delivery.bodyBytes}B`,
            ].join("  ") +
              missing +
              (delivery.error === null ? "" : `  ${delivery.error}`),
          );
        }
      }),
    ),
  ),
);

const scheduleWebhookCommand = Command.make("webhook").pipe(
  Command.withDescription("Manage a webhook task's URL and see what it received."),
  Command.withSubcommands([webhookRotateCommand, webhookDeliveriesCommand]),
);

export const scheduleCommand = Command.make("schedule").pipe(
  Command.withDescription("Create, change, and run scheduled tasks on the running server."),
  Command.withSubcommands([
    scheduleListCommand,
    scheduleShowCommand,
    scheduleCreateCommand,
    scheduleUpdateCommand,
    scheduleDeleteCommand,
    scheduleRunCommand,
    setEnabledCommand("enable"),
    setEnabledCommand("disable"),
    scheduleWebhookCommand,
  ]),
);
