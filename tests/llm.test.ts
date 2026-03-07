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
    }),
    3
  );

  assert.deepEqual(result, {
    removalReasonIndex: 1,
    justification: "Clearly violates rule 2.",
    confidence: 0.91,
    needsHumanReview: false,
  });
});

test("parseModerationDecision supports wrapped mixed-content JSON", () => {
  const result = __llmTestables.parseModerationDecision(
    [
      "```json",
      '{"removalReasonIndex":null,"justification":"No violation found.","confidence":0.73,"needsHumanReview":true}',
      "```",
    ].join("\n"),
    4
  );

  assert.deepEqual(result, {
    removalReasonIndex: null,
    justification: "No violation found.",
    confidence: 0.73,
    needsHumanReview: true,
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

test("buildLLMPrompt includes subreddit description context", () => {
  const prompt = buildLLMPrompt(
    "exampleSub",
    [{ id: "r1", title: "Rule title", message: "Rule message" }],
    "Submission body",
    "This community prioritizes constructive discussion."
  );

  assert.match(prompt, /"name": "exampleSub"/);
  assert.match(
    prompt,
    /"description": "This community prioritizes constructive discussion\."/
  );
});
