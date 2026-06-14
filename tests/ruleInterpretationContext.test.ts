import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRuleInterpretationContext,
  validateRuleInterpretationContextSetting,
} from "../src/ruleInterpretationContext.js";

test("parseRuleInterpretationContext treats empty values as disabled", () => {
  assert.deepEqual(parseRuleInterpretationContext(undefined), { ok: true });
  assert.deepEqual(parseRuleInterpretationContext("   "), { ok: true });
});

test("parseRuleInterpretationContext accepts and sanitizes JSON objects", () => {
  const result = parseRuleInterpretationContext(
    '{"terms":{"local":"allowed\\u0007 boundary"},"limits":["no hidden rules"]}'
  );

  assert.deepEqual(result, {
    ok: true,
    context: {
      terms: {
        local: "allowed boundary",
      },
      limits: ["no hidden rules"],
    },
  });
});

test("validateRuleInterpretationContextSetting rejects invalid JSON", () => {
  assert.equal(
    validateRuleInterpretationContextSetting("{not-json"),
    "Rule Interpretation Context must be a valid JSON object."
  );
});

test("validateRuleInterpretationContextSetting rejects non-object JSON", () => {
  assert.equal(
    validateRuleInterpretationContextSetting('["not", "an", "object"]'),
    "Rule Interpretation Context must be a valid JSON object."
  );
});

test("validateRuleInterpretationContextSetting rejects oversized context", () => {
  const oversized = JSON.stringify({ value: "x".repeat(4_100) });

  assert.equal(
    validateRuleInterpretationContextSetting(oversized),
    "Rule Interpretation Context must be 4000 characters or less."
  );
});
