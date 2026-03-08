import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_ENFORCEMENT_DISABLED_MARKER,
  isAutoEnforcementDisabledReason,
  selectEnforceableRemovalReasons,
} from "../src/moderation/removalReasonToggle.js";

test("isAutoEnforcementDisabledReason detects marker in title or message", () => {
  assert.equal(
    isAutoEnforcementDisabledReason({
      title: `Rule title ${AUTO_ENFORCEMENT_DISABLED_MARKER}`,
      message: "Rule body",
    }),
    true
  );

  assert.equal(
    isAutoEnforcementDisabledReason({
      title: "Rule title",
      message: `Rule body ${AUTO_ENFORCEMENT_DISABLED_MARKER}`,
    }),
    true
  );

  assert.equal(
    isAutoEnforcementDisabledReason({
      title: "Rule title",
      message: "Rule body",
    }),
    false
  );
});

test("selectEnforceableRemovalReasons filters disabled reasons and keeps source indices", () => {
  const reasons = [
    { id: "r1", title: "Rule 1", message: "Message 1" },
    {
      id: "r2",
      title: `Rule 2 ${AUTO_ENFORCEMENT_DISABLED_MARKER}`,
      message: "Message 2",
    },
    {
      id: "r3",
      title: "Rule 3",
      message: `Message 3 ${AUTO_ENFORCEMENT_DISABLED_MARKER}`,
    },
    { id: "r4", title: "Rule 4", message: "Message 4" },
  ];

  const selected = selectEnforceableRemovalReasons(reasons);

  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.originalIndex, 0);
  assert.equal(selected[0]?.reason.id, "r1");
  assert.equal(selected[1]?.originalIndex, 3);
  assert.equal(selected[1]?.reason.id, "r4");
});
