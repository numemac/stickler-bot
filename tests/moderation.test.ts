import assert from "node:assert/strict";
import test from "node:test";

import { __moderationTestables } from "../src/moderation.js";

test("buildCommentContextForPrompt includes post, ancestors, and target details", async () => {
  const commentsById = new Map([
    [
      "t1_parent",
      {
        id: "t1_parent",
        parentId: "t1_grand",
        postId: "t3_post",
        authorId: "t2_same",
        authorName: "same_user",
        body: "Parent context text",
      },
    ],
    [
      "t1_grand",
      {
        id: "t1_grand",
        parentId: "t3_post",
        postId: "t3_post",
        authorId: "t2_other",
        authorName: "other_user",
        body: "Grandparent context text",
      },
    ],
  ]);

  const reddit = {
    async getCommentById(id: string) {
      const comment = commentsById.get(id);
      if (comment == null) {
        throw new Error(`Missing comment ${id}`);
      }
      return comment;
    },
    async getPostById() {
      return {
        id: "t3_post",
        authorId: "t2_post_author",
        authorName: "post_author",
        title: "Top post title",
        body: "Top post body",
        url: "https://example.com/post",
      };
    },
  };

  const prompt = await __moderationTestables.buildCommentContextForPrompt(
    reddit as never,
    {
      id: "t1_target",
      parentId: "t1_parent",
      postId: "t3_post",
      authorId: "t2_same",
      authorName: "same_user",
      body: "Target text body",
    }
  );

  assert.match(prompt, /Post context at top of thread:/);
  assert.match(prompt, /- title: Top post title/);
  assert.match(prompt, /Parent chain context \(oldest -> newest\):/);
  assert.match(prompt, /- relation: grandparent/);
  assert.match(prompt, /- relation: parent/);
  assert.match(prompt, /Target comment \(this is the item to moderate\):/);
  assert.match(prompt, /- text: Target text body/);

  const relationGrandparentIndex = prompt.indexOf("- relation: grandparent");
  const relationParentIndex = prompt.indexOf("- relation: parent");
  assert.ok(
    relationGrandparentIndex < relationParentIndex,
    "ancestor chain should be ordered oldest to newest"
  );

  const targetAuthorMatch = prompt.match(
    /Target comment \(this is the item to moderate\):\n- author: (User_\d+)/
  );
  assert.ok(targetAuthorMatch != null, "target author label should exist");
  const targetAuthorLabel = targetAuthorMatch[1];
  assert.ok(
    prompt.includes(`- relation: parent\n  author: ${targetAuthorLabel}`),
    "parent and target should share anonymized label for same author"
  );
});

test("selectAncestorsForPrompt keeps root and newest ancestors when trimming", () => {
  const ancestorsOldestToNewest = Array.from({ length: 12 }, (_, index) => ({
    comment: {
      id: `ancestor_${index + 1}`,
      parentId: index === 0 ? "t3_post" : `ancestor_${index}`,
      postId: "t3_post",
      authorId: `t2_${index + 1}`,
      authorName: `user_${index + 1}`,
      body: `body_${index + 1}`,
    },
    distanceFromTarget: 12 - index,
  }));

  const result = __moderationTestables.selectAncestorsForPrompt(
    ancestorsOldestToNewest
  );

  assert.equal(result.selectedAncestors.length, 8);
  assert.equal(result.omittedAncestorCount, 4);
  assert.equal(result.selectedAncestors[0]?.comment.id, "ancestor_1");
  assert.deepEqual(
    result.selectedAncestors.slice(1).map((entry) => entry.comment.id),
    [
      "ancestor_6",
      "ancestor_7",
      "ancestor_8",
      "ancestor_9",
      "ancestor_10",
      "ancestor_11",
      "ancestor_12",
    ]
  );
});

test("createParticipantLabeler is stable for same user and distinct for others", () => {
  const labeler = __moderationTestables.createParticipantLabeler();

  const alphaLabel = labeler("t2_alpha", "alice", "src_1");
  const alphaLabelFromDifferentName = labeler("t2_alpha", "alice_renamed", "src_2");
  const betaLabel = labeler("t2_beta", "bob", "src_3");
  const noIdNameLabelOne = labeler(undefined, "CaseUser", "src_4");
  const noIdNameLabelTwo = labeler(undefined, "caseuser", "src_5");
  const deletedLabelOne = labeler(undefined, "[deleted]", "src_6");
  const deletedLabelTwo = labeler(undefined, "[deleted]", "src_7");

  assert.equal(alphaLabel, alphaLabelFromDifferentName);
  assert.notEqual(alphaLabel, betaLabel);
  assert.equal(noIdNameLabelOne, noIdNameLabelTwo);
  assert.notEqual(deletedLabelOne, deletedLabelTwo);
});

test("hasSubstantialVideoBodyText enforces minimum trimmed body length", () => {
  assert.equal(__moderationTestables.hasSubstantialVideoBodyText(undefined), false);
  assert.equal(__moderationTestables.hasSubstantialVideoBodyText(""), false);
  assert.equal(
    __moderationTestables.hasSubstantialVideoBodyText("x".repeat(199)),
    false
  );
  assert.equal(
    __moderationTestables.hasSubstantialVideoBodyText("x".repeat(200)),
    true
  );
  assert.equal(
    __moderationTestables.hasSubstantialVideoBodyText(`  ${"x".repeat(200)}  `),
    true
  );
});

test("isRedditVideoUploadPost detects reddit-hosted videos", () => {
  assert.equal(
    __moderationTestables.isRedditVideoUploadPost({
      url: "https://v.redd.it/abc123",
      secureMedia: undefined,
    }),
    true
  );

  assert.equal(
    __moderationTestables.isRedditVideoUploadPost({
      url: "https://www.reddit.com/r/test/comments/abc123/post",
      secureMedia: {
        redditVideo: { fallbackUrl: "https://v.redd.it/abc123/DASH_720.mp4" },
      },
    }),
    true
  );

  assert.equal(
    __moderationTestables.isRedditVideoUploadPost({
      url: "https://i.redd.it/example.jpeg",
      secureMedia: undefined,
    }),
    false
  );
});
