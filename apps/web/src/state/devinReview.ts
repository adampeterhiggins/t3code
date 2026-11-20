import { createDevinReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/devinReview";

import { connectionAtomRuntime } from "../connection/runtime";

export const devinReviewEnvironment = createDevinReviewEnvironmentAtoms(connectionAtomRuntime);
