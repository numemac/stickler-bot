import assert from "node:assert/strict";
import test from "node:test";

import { __llmTestables, buildLLMPrompt } from "../src/llm.js";

test("parseModerationDecision parses valid JSON payload", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 1,
      referenceLinkIndex: 0,
      justification: "Clearly violates rule 2.",
      confidence: 0.91,
      needsHumanReview: false,
      evidence: {
        evidenceBasis: "direct",
        visibleIdentifierTypes: ["username"],
        evidenceSummary: "A visible username is present in the screenshot.",
      },
    }),
    3,
    1
  );

  assert.deepEqual(result, {
    removalReasonIndex: 1,
    referenceLinkIndex: 0,
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
    referenceLinkIndex: null,
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
    referenceLinkIndex: null,
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
    referenceLinkIndex: null,
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

test("parseModerationDecision ignores out-of-range reference link index", () => {
  const result = __llmTestables.parseModerationDecision(
    JSON.stringify({
      removalReasonIndex: 0,
      referenceLinkIndex: 3,
      justification: "References a configured link that does not exist.",
      confidence: 0.95,
      needsHumanReview: false,
      evidence: {
        evidenceBasis: "unclear",
        visibleIdentifierTypes: [],
        evidenceSummary: "No visual evidence required.",
      },
    }),
    2,
    1
  );

  assert.deepEqual(result, {
    removalReasonIndex: 0,
    referenceLinkIndex: null,
    justification: "References a configured link that does not exist.",
    confidence: 0.95,
    needsHumanReview: false,
    evidence: {
      evidenceBasis: "unclear",
      visibleIdentifierTypes: [],
      evidenceSummary: "No visual evidence required.",
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
  assert.doesNotMatch(prompt, /"ruleInterpretationContext"/);
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

test("buildLLMPrompt includes optional rule interpretation context as advisory", () => {
  const prompt = buildLLMPrompt(
    "exampleSub",
    [{ id: "r1", title: "No harassment", message: "No personal attacks." }],
    "Submission body",
    "Community description.",
    "2026-03-07T14:30:00.000Z",
    {
      terms: {
        localTerm: "Use this to interpret the configured rules.",
      },
      limits: ["does not create hidden rules"],
    }
  );

  assert.match(prompt, /"ruleInterpretationContext": \{/);
  assert.match(prompt, /"localTerm": "Use this to interpret the configured rules\."/);
  assert.match(
    prompt,
    /ruleInterpretationContext is advisory only; it does not create new enforceable rules\./
  );
  assert.match(
    prompt,
    /Do not remove unless the contribution violates one listed removal reason\./
  );
  assert.match(
    prompt,
    /use it to make the justification fit the community's terminology and boundaries without citing hidden policy\./
  );
  assert.match(
    prompt,
    /The justification should explain the specific concern in the contribution, not restate the full removal reason\./
  );
});

test("buildLLMPrompt includes configured reference links without URLs", () => {
  const prompt = buildLLMPrompt(
    "exampleSub",
    [{ id: "r1", title: "No harassment", message: "No personal attacks." }],
    "Submission body",
    "Community description.",
    "2026-03-07T14:30:00.000Z",
    undefined,
    [
      {
        label: "Community explainer",
        url: "https://example.com/explainer",
        useWhen: "Use when this directly clarifies the removal explanation.",
      },
    ]
  );

  assert.match(prompt, /"referenceLinks": \[/);
  assert.match(prompt, /"label": "Community explainer"/);
  assert.match(prompt, /"use_when": "Use when this directly clarifies the removal explanation\."/);
  assert.doesNotMatch(prompt, /https:\/\/example\.com\/explainer/);
  assert.match(
    prompt,
    /Do not include URLs or markdown links in justification; the app will append the selected configured link\./
  );
});
