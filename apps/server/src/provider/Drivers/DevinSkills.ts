/** The CLI catalog includes project scopes and skill states that filesystem scans cannot reproduce. */
import * as NodeOS from "node:os";

import type { DevinSettings, ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import { isWindowsCommandNotFound } from "../../processRunner.ts";

/** Discovery budget matches the other provider skill probes (Codex uses 20s). */
const DEVIN_SKILLS_PROBE_TIMEOUT_MS = 20_000;

/** Skill catalogs are small; anything past this is treated as a runaway. */
const DEVIN_SKILLS_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class DevinSkillsProbeError extends Schema.TaggedError<DevinSkillsProbeError>()(
  "DevinSkillsProbeError",
  {
    stage: Schema.Literals(["spawn", "timeout", "exit", "output-limit", "decode"]),
    cwd: Schema.optional(Schema.String),
    exitCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const location = this.cwd === undefined ? "" : ` for '${this.cwd}'`;
    const exitCode = this.exitCode === undefined ? "" : ` with exit code ${this.exitCode}`;
    return `\`devin skills list --json\` failed during ${this.stage}${location}${exitCode}.`;
  }
}

/** One CLI record, narrowed to the fields the snapshot reads. */
const DevinSkillRecord = Schema.Struct({
  name: Schema.String,
  base_dir: Schema.String,
  description: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  triggers: Schema.optional(Schema.Array(Schema.String)),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
  warnings: Schema.optional(Schema.Array(Schema.Unknown)),
});

const DevinSkillsPayload = Schema.Array(Schema.Unknown);

const decodePayload = Schema.decodeUnknownOption(DevinSkillsPayload);
const decodeSkillRecord = Schema.decodeUnknownOption(DevinSkillRecord);

/**
 * Devin's user-global skill roots. Skills under one of these are personal;
 * skills under the workspace cwd are project; anything else keeps `other` so
 * the picker can still show it instead of discarding a valid skill.
 */
const DEVIN_PERSONAL_SKILL_ROOTS = [".devin/skills", ".config/devin/skills"];

type DevinSkillScope = "project" | "personal" | "other";

const deriveSkillScope = (
  path: Path.Path,
  baseDir: string,
  workspaceCwd: string | undefined,
): DevinSkillScope => {
  const normalizedBase = path.resolve(baseDir);
  if (workspaceCwd !== undefined) {
    const normalizedCwd = path.resolve(workspaceCwd);
    if (normalizedBase === normalizedCwd || normalizedBase.startsWith(normalizedCwd + path.sep)) {
      return "project";
    }
  }
  const personalRoot = DEVIN_PERSONAL_SKILL_ROOTS.find((root) => {
    const homeRoot = path.resolve(NodeOS.homedir(), root);
    return normalizedBase === homeRoot || normalizedBase.startsWith(homeRoot + path.sep);
  });
  return personalRoot !== undefined ? "personal" : "other";
};

/** Skill names deduplicate case-insensitively; errors disable entries, warnings do not. */
export function decodeDevinSkillRecords(
  stdout: string,
  path: Path.Path,
  workspaceCwd?: string,
): ReadonlyArray<ServerProviderSkill> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const decodedPayload = decodePayload(parsed);
  if (Option.isNone(decodedPayload)) {
    return undefined;
  }

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const entry of decodedPayload.value) {
    const decoded = decodeSkillRecord(entry);
    if (Option.isNone(decoded)) {
      continue;
    }
    const record = decoded.value;
    const name = record.name.trim();
    const baseDir = record.base_dir.trim();
    if (!name || !baseDir) {
      continue;
    }

    const skillPath = path.join(baseDir, "SKILL.md");
    const description = record.description?.trim();
    const displayName = record.display_name?.trim();
    const triggers = record.triggers ?? [];
    const hasErrors = (record.errors ?? []).length > 0;
    const skill: ServerProviderSkill = {
      name,
      path: skillPath,
      enabled: !hasErrors,
      scope: deriveSkillScope(path, baseDir, workspaceCwd),
      ...(description ? { description } : {}),
      ...(displayName ? { displayName } : {}),
      ...(triggers.includes("user") ? { userInvocable: true } : {}),
      ...(triggers.includes("user") && !triggers.includes("model")
        ? { userInvocationOnly: true }
        : {}),
    };

    const key = name.toLowerCase();
    if (!skillsByName.has(key)) {
      skillsByName.set(key, skill);
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Typed probe failures distinguish unavailable discovery from an authoritative empty catalog. */
const spawnBoundedSkillsCommand = Effect.fn("DevinSkills.spawnBoundedSkillsCommand")(function* (
  binaryPath: string,
  command: ChildProcess.Command,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner
    .spawn(command)
    .pipe(Effect.mapError((cause) => new DevinSkillsProbeError({ stage: "spawn", cause })));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectUint8StreamText({
        stream: child.stdout,
        maxBytes: DEVIN_SKILLS_MAX_OUTPUT_BYTES,
      }),
      collectUint8StreamText({
        stream: child.stderr,
        maxBytes: DEVIN_SKILLS_MAX_OUTPUT_BYTES,
      }),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => new DevinSkillsProbeError({ stage: "spawn", cause })));

  if (yield* isWindowsCommandNotFound(exitCode, stderr.text)) {
    return yield* new DevinSkillsProbeError({
      stage: "spawn",
      cause: new Error(`Devin command '${binaryPath}' was not found (exit code ${exitCode}).`),
    });
  }
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    code: exitCode,
    truncated: stdout.truncated || stderr.truncated,
  };
}, Effect.scoped);

const isDevinSkillsProbeError = Schema.is(DevinSkillsProbeError);

/** Typed probe failures distinguish unavailable discovery from an authoritative empty catalog. */
export const discoverDevinSkills = Effect.fn("discoverDevinSkills")(function* (
  devinSettings: Pick<DevinSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
) {
  const command = devinSettings.binaryPath || "devin";
  const listResult = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(command, ["skills", "list", "--json"], {
      env: environment,
    });
    return yield* spawnBoundedSkillsCommand(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        ...(cwd ? { cwd } : {}),
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  }).pipe(
    Effect.mapError((cause) =>
      isDevinSkillsProbeError(cause)
        ? cause
        : new DevinSkillsProbeError({
            stage: "spawn",
            ...(cwd ? { cwd } : {}),
            cause,
          }),
    ),
    Effect.timeoutOption(DEVIN_SKILLS_PROBE_TIMEOUT_MS),
  );

  if (Option.isNone(listResult)) {
    return yield* new DevinSkillsProbeError({
      stage: "timeout",
      ...(cwd ? { cwd } : {}),
    });
  }
  const output = listResult.value;
  if (output.truncated) {
    return yield* new DevinSkillsProbeError({
      stage: "output-limit",
      ...(cwd ? { cwd } : {}),
    });
  }
  if (output.code !== 0) {
    return yield* new DevinSkillsProbeError({
      stage: "exit",
      ...(cwd ? { cwd } : {}),
      exitCode: output.code,
    });
  }
  const path = yield* Path.Path;
  const skills = decodeDevinSkillRecords(output.stdout, path, cwd);
  if (!skills) {
    return yield* new DevinSkillsProbeError({
      stage: "decode",
      ...(cwd ? { cwd } : {}),
    });
  }
  return skills;
});
