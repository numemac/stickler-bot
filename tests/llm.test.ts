import assert from "node:assert/strict";
import test from "node:test";

import { __llmTestables, buildLLMPrompt } from "../src/llm.js";

test("parseModerationDecision parses valid JSON payload", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 1,
      justification: "Clearly violates rule 2.",
      confidence: 0.91,
      needsHumanReview: false,
      evidence: {
        evidenceBasis: "direct",
        visibleIdentifierTypes: ["username"],
        evidenceSummary: "A visible username is present in the screenshot.",
      },
    }),
    3
  );

  assert.deepEqual(result, {
    removalReasonIndex: 1,
    justification: "Clearly violates rule 2.",
    confidence: 0.91,
    needsHumanReview: false,
    evidence: {
      evidenceBasis: "direct",
      visibleIdentifierTypes: ["username"],
      evidenceSummary: "A visible username is present in the screenshot.",
    },
  });
});

test("parseModerationDecision supports wrapped mixed-content JSON", () => {
  const result = __llmTestables.parseModerationDecision(
    [
      "```json",
      '{"removalReasonIndex":null,"justification":"No violation found.","confidence":0.73,"needsHumanReview":true,"evidence":{"evidenceBasis":"unclear","visibleIdentifierTypes":[],"evidenceSummary":"No clear visual indicators were needed for this decision."}}',
      "```",
    ].join("\n"),
    4
  );

  assert.deepEqual(result, {
    removalReasonIndex: null,
    justification: "No violation found.",
    confidence: 0.73,
    needsHumanReview: true,
    evidence: {
      evidenceBasis: "unclear",
      visibleIdentifierTypes: [],
      evidenceSummary: "No clear visual indicators were needed for this decision.",
    },
  });
});

test("parseModerationDecision rejects out-of-range confidence", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 0,
      justification: "Bad confidence value.",
      confidence: 1.4,
      needsHumanReview: false,
    }),
    2
  );

  assert.equal(result, null);
});

test("parseModerationDecision rejects missing needsHumanReview", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 0,
      justification: "Missing flag field.",
      confidence: 0.52,
    }),
    2
  );

  assert.equal(result, null);
});

test("parseModerationDecision forces human review below confidence bar", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 0,
      justification: "Potentially rule-breaking but uncertain.",
      confidence: 0.61,
      needsHumanReview: false,
      evidence: {
        evidenceBasis: "inferred",
        visibleIdentifierTypes: [],
        evidenceSummary: "Signals are suggestive but not conclusive.",
      },
    }),
    2
  );

  assert.deepEqual(result, {
    removalReasonIndex: 0,
    justification: "Potentially rule-breaking but uncertain.",
    confidence: 0.61,
    needsHumanReview: true,
    evidence: {
      evidenceBasis: "inferred",
      visibleIdentifierTypes: [],
      evidenceSummary: "Signals are suggestive but not conclusive.",
    },
  });
});

test("parseModerationDecision falls back missing evidence metadata", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 1,
      justification: "Likely a violation but evidence payload was omitted.",
      confidence: 0.95,
      needsHumanReview: false,
    }),
    3
  );

  assert.deepEqual(result, {
    removalReasonIndex: 1,
    justification: "Likely a violation but evidence payload was omitted.",
    confidence: 0.95,
    needsHumanReview: false,
    evidence: {
      evidenceBasis: "unclear",
      visibleIdentifierTypes: [],
      evidenceSummary: "Evidence metadata unavailable or invalid in model output.",
    },
  });
});

test("buildLLMPrompt includes subreddit description and UTC time context", () => {
  const prompt = buildLLMPrompt(
    "exampleSub",
    [{ id: "r1", title: "Rule title", message: "Rule message" }],
    "Submission body",
    "This community prioritizes constructive discussion.",
    "2026-03-07T14:30:00.000Z"
  );

  assert.match(prompt, /"name": "exampleSub"/);
  assert.match(
    prompt,
    /"description": "This community prioritizes constructive discussion\."/
  );
  assert.match(prompt, /"currentDateTimeUtc": "2026-03-07T14:30:00\.000Z"/);
  assert.match(prompt, /"currentDayOfWeekUtc": "Saturday"/);
  assert.match(prompt, /"inputSectionsTruncated": false/);
  assert.match(
    prompt,
    /For screenshot-redaction\/privacy rules, only select a violation when identifying details are directly visible\./
  );
});

test("buildLLMPrompt marks truncated input sections", () => {
  const prompt = buildLLMPrompt(
    "exampleSub",
    [{ id: "r1", title: "Rule title", message: "Rule message" }],
    "x".repeat(8_200),
    "Context",
    "2026-03-07T14:30:00.000Z"
  );

  assert.match(prompt, /"inputSectionsTruncated": true/);
});
