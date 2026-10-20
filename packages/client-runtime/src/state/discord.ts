import { type DiscordThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { discordThreadContextRecord } from "@t3tools/shared/integrationContextRecords";

export function createDiscordEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The environment's Discord bot connection.
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:discord:connection",
      tag: WS_METHODS.discordSubscribeState,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:connect",
      tag: WS_METHODS.discordConnect,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:disconnect",
      tag: WS_METHODS.discordDisconnect,
    }),
    // Discord tells a bot nothing when it is added, so callers refresh this when it may change.
    servers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:discord:servers",
      tag: WS_METHODS.discordListServers,
      staleTimeMs: 0,
    }),
    leaveServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:leave-server",
      tag: WS_METHODS.discordLeaveServer,
    }),
    // Keyed by query text. Callers debounce typing: each search reads every server the bot is in.
    messages: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:discord:messages",
      tag: WS_METHODS.discordSearchMessages,
      staleTimeMs: 30_000,
    }),
    // Fetched once when a message is attached; the result is snapshotted into the message.
    getThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:get-thread",
      tag: WS_METHODS.discordGetThread,
    }),
    // Keyed by link. The server keeps each preview, so one read per session is enough.
    linkPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:discord:link-preview",
      tag: WS_METHODS.discordGetLinkPreview,
      staleTimeMs: Number.POSITIVE_INFINITY,
    }),
    // Every thread group's linked Discord thread in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:discord:thread-links",
      tag: WS_METHODS.discordSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:link-thread",
      tag: WS_METHODS.discordLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:discord:unlink-thread",
      tag: WS_METHODS.discordUnlinkThread,
    }),
  };
}

/** The Discord thread linked to the thread's tab group, if any. */
export function discordLinkForThread(
  links: ReadonlyArray<DiscordThreadLink> | null | undefined,
  threadId: ThreadId,
): DiscordThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}
