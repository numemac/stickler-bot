import assert from "node:assert/strict";
import test from "node:test";

import { moderateContribution } from "../src/moderation.js";
import { EVIDENCE_REQUIRED_MARKER } from "../src/moderation/removalReasonToggle.js";
import type { ModerationDecision } from "../src/types.js";

test("moderateContribution downgrades evidence-required rule to triage on unclear evidence", async () => {
  let triageCalled = false;
  let capturedSkipReason: string | null = null;
  let removeCalled = false;
  let submitCalled = false;

  const reason = {
    id: "r1",
    title: `Screenshots must be redacted ${EVIDENCE_REQUIRED_MARKER}`,
    message: "Redact usernames and locations in screenshots.",
  };

  const decision: ModerationDecision = {
    removalReasonIndex: 0,
    justification: "Identifiers are unclear.",
    confidence: 0.95,
    needsHumanReview: false,
    evidence: {
      evidenceBasis: "unclear",
      visibleIdentifierTypes: [],
      evidenceSummary: "Evidence metadata unavailable or unclear.",
    },
  };

  const reddit = {
    async getCurrentUser() {
      return { username: "modbot" };
    },
    async getSubredditRemovalReasons() {
      return [reason];
    },
    async submitComment() {
      submitCalled = true;
      throw new Error("submitComment should not be called for triage path");
    },
    async remove() {
      removeCalled = true;
    },
  };

  const result = await moderateContribution(
    reddit as never,
    "test-api-key",
    "post_1",
    "post",
    0.8,
    {
      async fetchContribution(_reddit, _contributionId, _type, _botUsername) {
        return {
          id: "post_1",
          authorName: "author",
          subredditName: "exampleSub",
          permalink: "/r/exampleSub/comments/post_1",
          contentForPrompt: "Title: test",
          imageUrls: ["https://i.redd.it/example.jpeg"],
          distinguishedBy: undefined,
          removed: false,
        };
      },
      async fetchSubredditDescription(_reddit, _subredditName) {
        return "Example subreddit";
      },
      buildLLMPrompt(
        _subredditName,
        _reasons,
        _content,
        _subredditDescription,
        _currentDateTimeUtc
      ) {
        return "prompt";
      },
      async getOpenAIResponse(_openaiApiKey, _prompt, _reasonCount, _imageUrls) {
        return decision;
      },
      async sendTriageModmail(
        _reddit,
        _contribution,
        _type,
        _reason,
        _justification,
        _confidence,
        _threshold,
        _needsHumanReview,
        skipReason
      ) {
        triageCalled = true;
        capturedSkipReason = skipReason;
      },
      buildRemovalReply(_type, _subredditName, _reason, _justification) {
        return "should-not-be-used";
      },
      now() {
        return "2026-03-18T00:00:00.000Z";
      },
    }
  );

  assert.equal(result, true);
  assert.equal(triageCalled, true);
  assert.equal(capturedSkipReason, "insufficient-evidence");
  assert.equal(submitCalled, false);
  assert.equal(removeCalled, false);
});

test("moderateContribution keeps non-evidence-required rules auto-enforceable", async () => {
  let triageCalled = false;
  let removeCalled = false;
  let submitCalled = false;

  const reason = {
    id: "r1",
    title: "No harassment",
    message: "No personal attacks.",
  };

  const decision: ModerationDecision = {
    removalReasonIndex: 0,
    justification: "Clear personal attack.",
    confidence: 0.95,
    needsHumanReview: false,
    evidence: {
      evidenceBasis: "unclear",
      visibleIdentifierTypes: [],
      evidenceSummary: "No visual evidence required for this rule.",
    },
  };

  const reddit = {
    async getCurrentUser() {
      return { username: "modbot" };
    },
    async getSubredditRemovalReasons() {
      return [reason];
    },
    async submitComment() {
      submitCalled = true;
      return {
        id: "mod_comment_1",
        distinguish() {},
      };
    },
    async remove() {
      removeCalled = true;
    },
  };

  const result = await moderateContribution(
    reddit as never,
    "test-api-key",
    "post_2",
    "post",
    0.8,
    {
      async fetchContribution(_reddit, _contributionId, _type, _botUsername) {
        return {
          id: "post_2",
          authorName: "author",
          subredditName: "exampleSub",
          permalink: "/r/exampleSub/comments/post_2",
          contentForPrompt: "Title: test",
          imageUrls: [],
          distinguishedBy: undefined,
          removed: false,
        };
      },
      async fetchSubredditDescription(_reddit, _subredditName) {
        return "Example subreddit";
      },
      buildLLMPrompt(
        _subredditName,
        _reasons,
        _content,
        _subredditDescription,
        _currentDateTimeUtc
      ) {
        return "prompt";
      },
      async getOpenAIResponse(_openaiApiKey, _prompt, _reasonCount, _imageUrls) {
        return decision;
      },
      async sendTriageModmail() {
        triageCalled = true;
      },
      buildRemovalReply(_type, _subredditName, _reason, _justification) {
        return "Removal reply";
      },
      now() {
        return "2026-03-18T00:00:00.000Z";
      },
    }
  );

  assert.equal(result, true);
  assert.equal(triageCalled, false);
  assert.equal(submitCalled, true);
  assert.equal(removeCalled, true);
});
