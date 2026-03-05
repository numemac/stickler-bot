import { type RedditAPIClient } from "@devvit/public-api";

import { MAX_CONTENT_CHARS } from "../constants.js";
import { sanitizeUntrustedText } from "../text.js";
import type { Contribution, ContributionType } from "../types.js";
import {
  buildCommentContextForPrompt,
  toPromptContextComment,
} from "./commentContext.js";
import {
  extractPostImageUrls,
  hasSubstantialVideoBodyText,
  isRedditVideoUploadPost,
  MIN_VIDEO_POST_BODY_CHARS_FOR_MODERATION,
} from "./postMedia.js";

/**
 * Fetches a contribution and normalizes it into a shared structure for prompt
 * generation and moderation decisions.
 */
export async function fetchContribution(
  reddit: RedditAPIClient,
  contributionId: string,
  type: ContributionType,
  botUsername: string
): Promise<Contribution | null> {
  if (type === "post") {
    const post = await reddit.getPostById(contributionId);
    if (post == null) {
      return null;
    }

    const isRedditVideoUpload = isRedditVideoUploadPost(post);
    const hasSubstantialBodyText = hasSubstantialVideoBodyText(post.body);
    const postParts = [`Title: ${post.title}`];
    if (post.body != null && post.body.trim().length > 0) {
      postParts.push(`Body: ${post.body.trim()}`);
    } else if (post.url.trim().length > 0) {
      postParts.push(`URL: ${post.url}`);
    }

    return {
      id: post.id,
      authorName: post.authorName,
      subredditName: sanitizeUntrustedText(post.subredditName, 128),
      permalink: sanitizeUntrustedText(post.permalink, 512),
      contentForPrompt: sanitizeUntrustedText(
        postParts.join("\n\n"),
        MAX_CONTENT_CHARS
      ),
      imageUrls: extractPostImageUrls(post),
      skipModerationReason:
        isRedditVideoUpload && !hasSubstantialBodyText
          ? `video upload without substantial body text (${MIN_VIDEO_POST_BODY_CHARS_FOR_MODERATION}+ body characters required)`
          : undefined,
      distinguishedBy: post.distinguishedBy,
      removed: post.removed,
    };
  }

  const comment = await reddit.getCommentById(contributionId);
  if (comment == null) {
    return null;
  }

  const shouldBuildThreadContext =
    !comment.removed &&
    comment.distinguishedBy == null &&
    comment.authorName.toLowerCase() !== botUsername;

  const commentContextForPrompt = shouldBuildThreadContext
    ? await buildCommentContextForPrompt(reddit, toPromptContextComment(comment))
    : sanitizeUntrustedText(comment.body, MAX_CONTENT_CHARS);

  return {
    id: comment.id,
    authorName: comment.authorName,
    subredditName: sanitizeUntrustedText(comment.subredditName, 128),
    permalink: sanitizeUntrustedText(comment.permalink, 512),
    contentForPrompt: commentContextForPrompt,
    imageUrls: [],
    distinguishedBy: comment.distinguishedBy,
    removed: comment.removed,
  };
}
