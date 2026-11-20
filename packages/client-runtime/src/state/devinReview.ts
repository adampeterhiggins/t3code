import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { devinReviewContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";

export function createDevinReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The environment's Devin connection: the Devin CLI's login or a service key.
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:devin-review:connection",
      tag: WS_METHODS.devinReviewSubscribeState,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:connect",
      tag: WS_METHODS.devinReviewConnect,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    signIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:sign-in",
      tag: WS_METHODS.devinReviewSignIn,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    cancelSignIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:cancel-sign-in",
      tag: WS_METHODS.devinReviewCancelSignIn,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:disconnect",
      tag: WS_METHODS.devinReviewDisconnect,
    }),
    // Keyed by involvement. Each read lists pull requests through the GitHub CLI.
    reviews: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:devin-review:reviews",
      tag: WS_METHODS.devinReviewList,
      staleTimeMs: 30_000,
    }),
    // Status and counts for several pull requests in one read, such as a thread's linked ones.
    summaries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:devin-review:summaries",
      tag: WS_METHODS.devinReviewSummaries,
      staleTimeMs: 60_000,
    }),
    // Fetched once when a review is attached; the result is snapshotted into the message.
    getReview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:get-review",
      tag: WS_METHODS.devinReviewGet,
    }),
    // The same read for the review page's detail pane and hover cards.
    review: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:devin-review:review",
      tag: WS_METHODS.devinReviewGet,
      staleTimeMs: 60_000,
    }),
    // Devin's own status for one pull request, polled while its review is on screen.
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:devin-review:status",
      tag: WS_METHODS.devinReviewStatus,
      staleTimeMs: 5_000,
    }),
    // What Devin's reviewer is doing, pushed while subscribed to a queued or running review.
    progress: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:devin-review:progress",
      tag: WS_METHODS.devinReviewSubscribeProgress,
      // The server polls Devin every 2 seconds for each subscription, so drop it soon after.
      idleTtlMs: 10_000,
    }),
    trigger: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:devin-review:trigger",
      tag: WS_METHODS.devinReviewTrigger,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.url}`,
      },
    }),
  };
}
