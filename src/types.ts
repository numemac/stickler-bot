/**
 * Shared domain type module.
 *
 * This module defines core moderation data contracts exchanged across
 * triggers, services, and LLM integration layers.
 */
export type ContributionType = "post" | "comment";

export type EvidenceBasis = "direct" | "inferred" | "unclear";

export type VisibleIdentifierType =
  | "username"
  | "display_name"
  | "profile_photo"
  | "face"
  | "location"
  | "external_handle_or_link"
  | "other_unique_identifier";

export type ModerationDecisionEvidence = {
  evidenceBasis: EvidenceBasis;
  visibleIdentifierTypes: VisibleIdentifierType[];
  evidenceSummary: string;
};

export type ModerationDecision = {
  removalReasonIndex: number | null;
  referenceLinkIndex: number | null;
  justification: string;
  confidence: number;
  needsHumanReview: boolean;
  evidence: ModerationDecisionEvidence;
};

export type ReferenceLink = {
  label: string;
  url: string;
  useWhen: string;
};

export type ModerationOutcome =
  | { status: "removed"; removalReasonTitle: string }
  | { status: "triaged"; removalReasonTitle: string }
  | { status: "no-removal-reason" }
  | { status: "failed" };

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
