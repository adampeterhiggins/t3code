import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ChildProcessSpawner } from "effect/process";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubApi from "./GitHubApi.ts";
import * as GitHubCli from "./GitHubCli.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});
function harness(input: {
  readonly api: Partial<GitHubApi.GitHubApi["Service"]>;
  readonly run: VcsProcess.VcsProcess["Service"]["run"];
}) {
  const layer = Layer.effect(GitHubCli.GitHubCli, GitHubCli.make).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(VcsProcess.VcsProcess)({ run: input.run }),
        Layer.mock(GitHubApi.GitHubApi)(input.api),
        NodeServices.layer,
      ),
    ),
  );
  return { layer };
}

it.effect("fork context reads use the selected host credential without requiring a checkout", () =>
  Effect.gen(function* () {
    const calls: Array<Parameters<VcsProcess.VcsProcess["Service"]["run"]>[0]> = [];
    const hosts: string[] = [];
    const { layer } = harness({
      api: {
        credential: (host) =>
          Effect.sync(() => {
            hosts.push(host);
            return { token: Redacted.make("test-selected-account"), fingerprint: "selected" };
          }),
      },
      run: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return processOutput("[]");
        }),
    });
    yield* GitHubCli.GitHubCli.pipe(
      Effect.flatMap((gh) =>
        gh.execute({ cwd: "/not-a-checkout", args: ["repo", "list", "acme", "--json", "name"] }),
      ),
      Effect.provide(layer),
    );
    assert.deepEqual(hosts, ["github.com"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "gh");
    assert.equal(calls[0]?.env?.GH_TOKEN, "test-selected-account");
  }),
);

it.effect("fork issue context uses the enterprise host named by its URL", () =>
  Effect.gen(function* () {
    const hosts: string[] = [];
    const { layer } = harness({
      api: {
        credential: (host) =>
          Effect.sync(() => {
            hosts.push(host);
            return { token: Redacted.make("test-enterprise-account"), fingerprint: "enterprise" };
          }),
      },
      run: () => Effect.succeed(processOutput("{}")),
    });
    yield* GitHubCli.GitHubCli.pipe(
      Effect.flatMap((gh) =>
        gh.execute({
          cwd: "/not-a-checkout",
          args: [
            "issue",
            "view",
            "https://github.example.com/acme/web/issues/7",
            "--json",
            "number",
          ],
        }),
      ),
      Effect.provide(layer),
    );
    assert.deepEqual(hosts, ["github.example.com"]);
  }),
);
