import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDecisionSafety } from "../src/moderation/decisionSafety.js";
import { EVIDENCE_REQUIRED_MARKER } from "../src/moderation/removalReasonToggle.js";

test("evaluateDecisionSafety forces human review when screenshot evidence is inferred", () => {
  const result = evaluateDecisionSafety(
    {
      title: `Screenshots must be redacted ${EVIDENCE_REQUIRED_MARKER}`,
      message: "Redact usernames and locations.",
    },
    {
      evidenceBasis: "inferred",
      visibleIdentifierTypes: ["username"],
      evidenceSummary: "A username might be present but is partially cut off.",
    },
    true
  );

  assert.deepEqual(result, {
    forceHumanReview: true,
    skipReason: "insufficient-evidence",
  });
});

test("evaluateDecisionSafety forces human review when direct evidence lacks identifier types", () => {
  const result = evaluateDecisionSafety(
    {
      title: `Screenshots must be redacted ${EVIDENCE_REQUIRED_MARKER}`,
      message: "Redact usernames and locations.",
    },
    {
      evidenceBasis: "direct",
      visibleIdentifierTypes: [],
      evidenceSummary: "No explicit identifier category was listed.",
    },
    true
  );

  assert.deepEqual(result, {
    forceHumanReview: true,
    skipReason: "insufficient-evidence",
  });
});

test("evaluateDecisionSafety allows enforcement when screenshot evidence is direct and explicit", () => {
  const result = evaluateDecisionSafety(
    {
      title: `Screenshots must be redacted ${EVIDENCE_REQUIRED_MARKER}`,
      message: "Redact usernames and locations.",
    },
    {
      evidenceBasis: "direct",
      visibleIdentifierTypes: ["username", "location"],
      evidenceSummary: "Both a username and location are clearly visible.",
    },
    true
  );

  assert.deepEqual(result, {
    forceHumanReview: false,
    skipReason: null,
  });
});

test("evaluateDecisionSafety forces human review when evidence-required rule has no images", () => {
  const result = evaluateDecisionSafety(
    {
      title: `Screenshots must be redacted ${EVIDENCE_REQUIRED_MARKER}`,
      message: "Redact usernames and locations.",
    },
    {
      evidenceBasis: "direct",
      visibleIdentifierTypes: ["username"],
      evidenceSummary: "A username is visible.",
    },
    false
  );

  assert.deepEqual(result, {
    forceHumanReview: true,
    skipReason: "insufficient-evidence",
  });
});

test("evaluateDecisionSafety does not alter rules without evidence-required marker", () => {
  const result = evaluateDecisionSafety(
    {
      title: "No harassment / bigotry",
      message: "No hate, harassment, or dehumanization.",
    },
    {
      evidenceBasis: "inferred",
      visibleIdentifierTypes: [],
      evidenceSummary: "No visual evidence needed for this text-only rule.",
    },
    true
  );

  assert.deepEqual(result, {
    forceHumanReview: false,
    skipReason: null,
  });
});
