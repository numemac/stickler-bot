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
  confidence: number;
  needsHumanReview: boolean;
};

export type Contribution = {
  id: string;
  authorName: string;
  subredditName: string;
  permalink: string;
  contentForPrompt: string;
  imageUrls: string[];
  skipModerationReason?: string;
  distinguishedBy?: string;
  removed: boolean;
};
