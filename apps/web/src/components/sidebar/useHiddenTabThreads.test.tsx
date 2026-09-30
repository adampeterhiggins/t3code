import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId, type ThreadTabMembership } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useHiddenTabThreads } from "./useHiddenTabThreads";

const mocks = vi.hoisted(() => ({
  runPromise: vi.fn(),
  environments: [{ environmentId: "local", connection: { phase: "connected" } }],
}));
vi.mock("../../lib/runtime", () => ({ runtime: { runPromise: mocks.runPromise } }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: mocks.environments }),
}));
vi.mock("../../state/session", () => ({
  readPreparedConnection: (environmentId: string) => ({ environmentId }),
}));
vi.mock("@t3tools/client-runtime/thread-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/thread-tabs")>()),
  listThreadTabMemberships: (prepared: unknown) => prepared,
}));

let renderer: ReactTestRenderer;
let visibleRows: string[][];
const root = ThreadId.make("root");
const child = ThreadId.make("child");
const ordinary = ThreadId.make("ordinary");
const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const shell = (id: ThreadId, environmentId = local) =>
  ({ id, environmentId, archivedAt: null }) as EnvironmentThreadShell;

function pendingMemberships() {
  let resolve!: (rows: ReadonlyArray<ThreadTabMembership>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReadonlyArray<ThreadTabMembership>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Probe({ threads }: { threads: ReadonlyArray<EnvironmentThreadShell> }) {
  const { hiddenTabThreads } = useHiddenTabThreads(threads);
  useLayoutEffect(() => {
    visibleRows.push(
      threads
        .filter((thread) => !hiddenTabThreads.has(`${thread.environmentId}:${thread.id}`))
        .map((thread) => thread.id),
    );
  });
  return null;
}

beforeEach(() => {
  visibleRows = [];
  mocks.runPromise.mockReset();
  mocks.environments = [{ environmentId: "local", connection: { phase: "connected" } }];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("never commits a standalone tab row while membership is pending", async () => {
  mocks.runPromise.mockResolvedValueOnce([]);
  await act(async () => {
    renderer = create(<Probe threads={[shell(root)]} />);
  });
  expect(visibleRows.at(-1)).toEqual([root]);
  const lookup = pendingMemberships();
  mocks.runPromise.mockReturnValueOnce(lookup.promise);
  await act(async () => {
    renderer.update(<Probe threads={[shell(root), shell(child)]} />);
  });
  expect(visibleRows.at(-1)).toEqual([root]);
  await act(async () => {
    lookup.resolve([root, child].map((threadId) => ({ threadId, groupId: root })));
  });
  expect(visibleRows.every((rows) => !rows.includes(child))).toBe(true);
  expect(visibleRows.at(-1)).toEqual([root]);
});

it("ignores a stale response and releases ordinary threads if the endpoint fails", async () => {
  mocks.runPromise.mockResolvedValueOnce([]);
  await act(async () => {
    renderer = create(<Probe threads={[shell(root)]} />);
  });
  const stale = pendingMemberships();
  const current = pendingMemberships();
  mocks.runPromise.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
  await act(async () => {
    renderer.update(<Probe threads={[shell(root), shell(child)]} />);
  });
  await act(async () => {
    renderer.update(<Probe threads={[shell(root), shell(child), shell(ordinary)]} />);
  });
  await act(async () => {
    stale.resolve([]);
  });
  expect(visibleRows.at(-1)).toEqual([root]);
  await act(async () => {
    current.reject(new Error("404: upstream has no tabs"));
  });
  expect(visibleRows.at(-1)).toEqual([root, child, ordinary]);
});

it("shows a classified local thread while another environment is still loading", async () => {
  mocks.environments = [local, remote].map((environmentId) => ({
    environmentId,
    connection: { phase: "connected" },
  }));
  const localLookup = pendingMemberships();
  const remoteLookup = pendingMemberships();
  mocks.runPromise
    .mockReturnValueOnce(localLookup.promise)
    .mockReturnValueOnce(remoteLookup.promise);
  await act(async () => {
    renderer = create(<Probe threads={[shell(root), shell(ordinary, remote)]} />);
  });
  await act(async () => {
    localLookup.resolve([]);
  });
  expect(visibleRows.at(-1)).toEqual([root]);
  await act(async () => {
    remoteLookup.resolve([]);
  });
  expect(visibleRows.at(-1)).toEqual([root, ordinary]);
});
