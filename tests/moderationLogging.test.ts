import assert from "node:assert/strict";
import test from "node:test";

import {
  formatModerationLogMessage,
  formatModerationOutcomeSummary,
} from "../src/moderation/logging.js";

test("formatModerationLogMessage prefixes contribution context and timestamp", () => {
  assert.equal(
    formatModerationLogMessage(
      "post:t3_example",
      "No violation detected",
      "2026-06-15T12:34:56.789Z"
    ),
    "[post:t3_example] [2026-06-15T12:34:56.789Z] No violation detected"
  );
});

test("formatModerationOutcomeSummary includes status and removal reason when present", () => {
  assert.equal(
    formatModerationOutcomeSummary({ status: "no-removal-reason" }),
    "Completed moderation (status=no-removal-reason)"
  );

  assert.equal(
    formatModerationOutcomeSummary({
      status: "removed",
      removalReasonTitle: "No harassment",
    }),
    'Completed moderation (status=removed, removalReason="No harassment")'
  );
});
