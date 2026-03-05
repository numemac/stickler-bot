/**
 * Shared domain type module.
 *
 * This module defines core moderation data contracts exchanged across
 * triggers, services, and LLM integration layers.
 */
export type ContributionType = "post" | "comment";

export type ModerationDecision = {
  removalReasonIndex: number | null;
  justification: string;
};

export type Contribution = {
  id: string;
  authorName: string;
  subredditName: string;
  contentForPrompt: string;
  imageUrls: string[];
  distinguishedBy?: string;
  removed: boolean;
};
