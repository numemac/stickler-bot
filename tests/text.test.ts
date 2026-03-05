import assert from "node:assert/strict";
import test from "node:test";

import { sanitizePublicRemovalJustification } from "../src/text.js";

test("sanitizePublicRemovalJustification strips direct quoted snippets", () => {
  const result = sanitizePublicRemovalJustification(
    'This was removed because it contains "you are trash" and repeats abuse. Please keep it civil.',
    900
  );

  assert.match(result, /This was removed because it contains and repeats abuse\./);
  assert.doesNotMatch(result, /you are trash/i);
  assert.doesNotMatch(result, /"/);
});

test("sanitizePublicRemovalJustification removes blockquotes and falls back when empty", () => {
  const result = sanitizePublicRemovalJustification(
    ["> this line quotes the offending content", '"same quoted content"'].join("\n"),
    240
  );

  assert.match(result, /^This was removed because it appears to break a subreddit rule\./);
});

test("sanitizePublicRemovalJustification respects max length", () => {
  const maxChars = 80;
  const result = sanitizePublicRemovalJustification(
    "This was removed for repeated uncivil language in this thread. Please keep future replies respectful and focused on the topic.",
    maxChars
  );

  assert.ok(result.length <= maxChars);
});
