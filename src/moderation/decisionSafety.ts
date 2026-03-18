import type { ModerationDecisionEvidence } from "../types.js";
import { isEvidenceRequiredReason } from "./removalReasonToggle.js";

export type DecisionSafetyEvaluation = {
  forceHumanReview: boolean;
  skipReason: "insufficient-evidence" | null;
};

/**
 * Applies deterministic safety checks for high-risk, image-based rule decisions.
 */
export function evaluateDecisionSafety(
  reason: { title: string; message: string },
  evidence: ModerationDecisionEvidence,
  hasImageUrls: boolean
): DecisionSafetyEvaluation {
  if (!isEvidenceRequiredReason(reason)) {
    return {
      forceHumanReview: false,
      skipReason: null,
    };
  }

  if (!hasImageUrls) {
    return {
      forceHumanReview: true,
      skipReason: "insufficient-evidence",
    };
  }

  if (evidence.evidenceBasis !== "direct") {
    return {
      forceHumanReview: true,
      skipReason: "insufficient-evidence",
    };
  }

  if (evidence.visibleIdentifierTypes.length === 0) {
    return {
      forceHumanReview: true,
      skipReason: "insufficient-evidence",
    };
  }

  return {
    forceHumanReview: false,
    skipReason: null,
  };
}
