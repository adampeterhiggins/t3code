import { createFileRoute } from "@tanstack/react-router";

import { DevinReviewsPage } from "../components/devinReview/DevinReviewsPage";
import {
  type DevinReviewInvolvement,
  isDevinReviewInvolvement,
} from "../components/devinReview/devinReview.logic";

interface DevinReviewsSearch {
  readonly involvement: DevinReviewInvolvement;
  /** The selected review's Devin URL. */
  readonly selected?: string | undefined;
}

export const Route = createFileRoute("/_chat/devin-reviews")({
  validateSearch: (raw: Record<string, unknown>): DevinReviewsSearch => ({
    involvement: isDevinReviewInvolvement(raw.involvement) ? raw.involvement : "all",
    selected:
      typeof raw.selected === "string" && raw.selected ? raw.selected.slice(0, 2048) : undefined,
  }),
  component: DevinReviewsPage,
});
