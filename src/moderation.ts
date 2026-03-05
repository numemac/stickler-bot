/**
 * Moderation orchestration module.
 *
 * This module owns contribution fetching, moderation guardrails, LLM decision
 * execution, and final Reddit moderation actions.
 */
import { type RedditAPIClient, type RemovalReason } from "@devvit/public-api";

import {
  BOT_USERNAME_FALLBACK,
  MAX_CONTENT_CHARS,
  MAX_REPLY_CHARS,
  MAX_VISION_IMAGES,
} from "./constants.js";
import { buildLLMPrompt, getOpenAIResponse } from "./llm.js";
import {
  sanitizeModelJustification,
  sanitizeUntrustedText,
  toSingleLine,
  truncate,
} from "./text.js";
import type { Contribution, ContributionType } from "./types.js";

const inFlightModerations = new Set<string>();
const triageModmailSentAt = new Map<string, number>();
const MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH = 24;
const MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT = 8;
const MAX_TARGET_COMMENT_CONTEXT_CHARS = 900;
const MAX_ANCESTOR_COMMENT_CONTEXT_CHARS = 320;
const MAX_POST_CONTEXT_TITLE_CHARS = 220;
const MAX_POST_CONTEXT_BODY_CHARS = 700;
const MAX_POST_CONTEXT_URL_CHARS = 320;
const MAX_TRIAGE_MODMAIL_SUBJECT_CHARS = 100;
const MAX_TRIAGE_MODMAIL_BODY_CHARS = 8_000;
const TRIAGE_MODMAIL_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const TRIAGE_MODMAIL_CACHE_MAX_ENTRIES = 5_000;

type PromptContextComment = {
  id: string;
  parentId: string;
  postId: string;
  authorId?: string;
  authorName: string;
  body: string;
};

type PromptContextPost = {
  id: string;
  authorId?: string;
  authorName: string;
  title: string;
  body?: string;
  url: string;
};

type AncestorContextEntry = {
  comment: PromptContextComment;
  distanceFromTarget: number;
};

type TriageSkipReason = "needs-human-review" | "below-threshold";

/**
 * Runs end-to-end moderation for a single post or comment.
 */
export async function moderateContribution(
  reddit: RedditAPIClient,
  openaiApiKey: string,
  contributionId: string,
  type: ContributionType,
  autoEnforceConfidenceThreshold: number
): Promise<boolean> {
  const moderationKey = `${type}:${contributionId}`;
  if (inFlightModerations.has(moderationKey)) {
    console.log(`Skipping duplicate in-flight moderation for ${moderationKey}`);
    return true;
  }

  inFlightModerations.add(moderationKey);

  try {
    const botUsername =
      (await reddit.getCurrentUser())?.username?.toLowerCase() ??
      BOT_USERNAME_FALLBACK;

    const contribution = await fetchContribution(
      reddit,
      contributionId,
      type,
      botUsername
    );
    if (contribution == null) {
      console.error(`Could not fetch ${type} with id ${contributionId}`);
      return false;
    }

    if (contribution.removed) {
      console.log(`Skipping ${moderationKey} because it is already removed.`);
      return true;
    }

    if (contribution.distinguishedBy != null) {
      console.log(`Skipping ${moderationKey} because it is distinguished.`);
      return true;
    }

    if (contribution.authorName.toLowerCase() === botUsername) {
      console.log(`Skipping ${moderationKey} because it was created by the bot.`);
      return true;
    }

    const removalReasons = await reddit.getSubredditRemovalReasons(
      contribution.subredditName
    );
    if (removalReasons.length === 0) {
      console.error(
        `Subreddit r/${contribution.subredditName} has no removal reasons configured`
      );
      return false;
    }

    const llmPrompt = buildLLMPrompt(
      contribution.subredditName,
      removalReasons,
      contribution.contentForPrompt
    );

    const llmDecision = await getOpenAIResponse(
      openaiApiKey,
      llmPrompt,
      removalReasons.length,
      contribution.imageUrls
    );
    if (llmDecision == null) {
      console.error(`Failed to get a valid moderation decision for ${moderationKey}`);
      return false;
    }

    const { removalReasonIndex, justification, confidence, needsHumanReview } =
      llmDecision;
    if (removalReasonIndex === null) {
      console.log(
        `No violation detected for ${moderationKey} (confidence=${formatConfidence(
          confidence
        )}, needsHumanReview=${needsHumanReview})`
      );
      return true;
    }

    const violatedReason = removalReasons[removalReasonIndex];
    if (violatedReason == null) {
      console.error(
        `LLM returned out-of-range removalReasonIndex=${removalReasonIndex} for ${moderationKey}`
      );
      return false;
    }

    if (needsHumanReview) {
      await sendTriageModmail(
        reddit,
        contribution,
        type,
        violatedReason,
        justification,
        confidence,
        autoEnforceConfidenceThreshold,
        needsHumanReview,
        "needs-human-review"
      );
      console.log(
        `Flagged ${moderationKey} for human review: reason [${removalReasonIndex}] ${violatedReason.title} (confidence=${formatConfidence(
          confidence
        )}, threshold=${formatConfidence(autoEnforceConfidenceThreshold)})`
      );
      return true;
    }

    if (confidence < autoEnforceConfidenceThreshold) {
      await sendTriageModmail(
        reddit,
        contribution,
        type,
        violatedReason,
        justification,
        confidence,
        autoEnforceConfidenceThreshold,
        needsHumanReview,
        "below-threshold"
      );
      console.log(
        `Not auto-enforcing ${moderationKey}: confidence ${formatConfidence(
          confidence
        )} below threshold ${formatConfidence(autoEnforceConfidenceThreshold)} for reason [${removalReasonIndex}] ${violatedReason.title}`
      );
      return true;
    }

    const replyText = buildRemovalReply(
      type,
      contribution.subredditName,
      violatedReason,
      justification
    );

    try {
      const reply = await reddit.submitComment({
        id: contribution.id,
        text: replyText,
        runAs: "APP",
      });
      console.log(
        `Posted removal comment ${reply.id} on ${moderationKey} for reason [${removalReasonIndex}] ${violatedReason.title}`
      );
    } catch (error) {
      console.error(`Failed to post removal comment on ${moderationKey}`, error);
    }

    await reddit.remove(contribution.id, false);
    console.log(
      `Removed ${moderationKey} for reason [${removalReasonIndex}] ${violatedReason.title}`
    );

    return true;
  } catch (error) {
    console.error(`Unexpected moderation failure for ${moderationKey}`, error);
    return false;
  } finally {
    inFlightModerations.delete(moderationKey);
  }
}

/**
 * Formats confidence values as fixed precision percentages for logs.
 */
function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(1)}%`;
}

/**
 * Sends a modmail triage notice when auto-enforcement is skipped.
 */
async function sendTriageModmail(
  reddit: RedditAPIClient,
  contribution: Contribution,
  type: ContributionType,
  reason: RemovalReason,
  justification: string,
  confidence: number,
  autoEnforceConfidenceThreshold: number,
  needsHumanReview: boolean,
  skipReason: TriageSkipReason
): Promise<void> {
  const safeSubredditName = toSingleLine(
    sanitizeUntrustedText(contribution.subredditName, 128)
  );
  const safeReasonTitle = toSingleLine(sanitizeUntrustedText(reason.title, 256));
  const safeAuthorName = toSingleLine(sanitizeUntrustedText(contribution.authorName, 128));
  const safeJustification = sanitizeModelJustification(justification, 1_200);
  const contributionUrl = toAbsoluteRedditUrl(contribution.permalink);
  const skipReasonText =
    skipReason === "needs-human-review"
      ? "Model requested human review"
      : "Confidence below auto-enforcement threshold";
  const triageKey = `${type}:${contribution.id}`;

  if (hasRecentTriageModmail(triageKey)) {
    console.log(
      `Skipping duplicate triage modmail for ${triageKey} (cooldown active)`
    );
    return;
  }

  const subject = truncate(
    toSingleLine(
      sanitizeUntrustedText(
        `[AI Triage] ${type} ${contribution.id} • ${formatConfidence(confidence)} • ${skipReasonText}`,
        200
      )
    ),
    MAX_TRIAGE_MODMAIL_SUBJECT_CHARS
  );

  const body = truncate(
    sanitizeUntrustedText(
      [
        "AI auto-enforcement was skipped. Please review this item.",
        "",
        `- **Skip reason:** ${skipReasonText}`,
        `- **Subreddit:** r/${safeSubredditName}`,
        `- **Contribution:** ${type} ${contribution.id}`,
        `- **Author:** u/${safeAuthorName}`,
        `- **Link:** ${contributionUrl}`,
        `- **Suggested rule:** ${safeReasonTitle}`,
        `- **Confidence:** ${formatConfidence(confidence)} (threshold ${formatConfidence(
          autoEnforceConfidenceThreshold
        )})`,
        `- **needsHumanReview:** ${needsHumanReview}`,
        "",
        "**Model justification**",
        safeJustification,
      ].join("\n"),
      MAX_TRIAGE_MODMAIL_BODY_CHARS
    ),
    MAX_TRIAGE_MODMAIL_BODY_CHARS
  );

  try {
    await reddit.modMail.createConversation({
      subredditName: safeSubredditName,
      subject,
      body,
      to: null,
    });
    rememberTriageModmail(triageKey);
    console.log(
      `Created modmail triage conversation for ${type}:${contribution.id} (${skipReason})`
    );
  } catch (error) {
    console.error(
      `Failed to create modmail triage conversation for ${type}:${contribution.id}`,
      error
    );
  }
}

/**
 * Returns true when a triage modmail was recently sent for this contribution.
 */
function hasRecentTriageModmail(triageKey: string): boolean {
  const now = Date.now();
  pruneTriageModmailCache(now);

  const lastSentAt = triageModmailSentAt.get(triageKey);
  return lastSentAt != null && now - lastSentAt < TRIAGE_MODMAIL_COOLDOWN_MS;
}

/**
 * Records a triage modmail send time for duplicate suppression.
 */
function rememberTriageModmail(triageKey: string): void {
  const now = Date.now();
  triageModmailSentAt.set(triageKey, now);
  pruneTriageModmailCache(now);
}

/**
 * Removes expired triage cache entries and bounds map growth.
 */
function pruneTriageModmailCache(now: number): void {
  for (const [key, sentAt] of triageModmailSentAt.entries()) {
    if (now - sentAt >= TRIAGE_MODMAIL_COOLDOWN_MS) {
      triageModmailSentAt.delete(key);
    }
  }

  while (triageModmailSentAt.size > TRIAGE_MODMAIL_CACHE_MAX_ENTRIES) {
    const oldestEntry = triageModmailSentAt.entries().next().value;
    if (oldestEntry == null) {
      break;
    }

    triageModmailSentAt.delete(oldestEntry[0]);
  }
}

/**
 * Returns an absolute Reddit URL for a contribution permalink.
 */
function toAbsoluteRedditUrl(permalink: string): string {
  const trimmed = permalink.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return `https://www.reddit.com${trimmed}`;
  }

  return `https://www.reddit.com/${trimmed}`;
}

/**
 * Fetches a contribution and normalizes it into a shared structure for prompt
 * generation and moderation decisions.
 */
async function fetchContribution(
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

/**
 * Builds structured prompt context for a reported comment, including parent
 * chain and top-level post context.
 */
async function buildCommentContextForPrompt(
  reddit: RedditAPIClient,
  targetComment: PromptContextComment
): Promise<string> {
  const { ancestorsClosestFirst, truncatedByFetchLimit } =
    await fetchCommentAncestors(reddit, targetComment);

  const ancestorsOldestToNewest = [...ancestorsClosestFirst]
    .reverse()
    .map((ancestor, index, allAncestors) => ({
      comment: ancestor,
      distanceFromTarget: allAncestors.length - index,
    }));

  const { selectedAncestors, omittedAncestorCount } = selectAncestorsForPrompt(
    ancestorsOldestToNewest
  );

  let postContext: PromptContextPost | null = null;
  try {
    const post = await reddit.getPostById(targetComment.postId);
    postContext = toPromptContextPost(post);
  } catch (error) {
    console.warn(
      `Could not fetch post context ${targetComment.postId} while building comment context for ${targetComment.id}`,
      error
    );
  }

  const getParticipantLabel = createParticipantLabeler();

  if (postContext != null) {
    getParticipantLabel(postContext.authorId, postContext.authorName, postContext.id);
  }
  for (const ancestor of selectedAncestors) {
    getParticipantLabel(
      ancestor.comment.authorId,
      ancestor.comment.authorName,
      ancestor.comment.id
    );
  }
  const targetAuthorLabel = getParticipantLabel(
    targetComment.authorId,
    targetComment.authorName,
    targetComment.id
  );

  const lines: string[] = [
    "Contribution type: comment",
    "Decision scope: evaluate only the target comment for rule violations.",
    "Participant labels are anonymized and consistent: the same label means the same Reddit author.",
    "",
    "Post context at top of thread:",
  ];

  if (postContext == null) {
    lines.push("- unavailable");
  } else {
    const postAuthorLabel = getParticipantLabel(
      postContext.authorId,
      postContext.authorName,
      postContext.id
    );
    lines.push(`- author: ${postAuthorLabel}`);
    lines.push(
      `- title: ${sanitizePromptSegment(
        postContext.title,
        MAX_POST_CONTEXT_TITLE_CHARS,
        "[untitled]"
      )}`
    );

    const trimmedPostBody = postContext.body?.trim();
    if (trimmedPostBody != null && trimmedPostBody.length > 0) {
      lines.push(
        `- body: ${sanitizePromptSegment(
          trimmedPostBody,
          MAX_POST_CONTEXT_BODY_CHARS,
          "[empty body]"
        )}`
      );
    } else {
      lines.push(
        `- url: ${sanitizePromptSegment(
          postContext.url,
          MAX_POST_CONTEXT_URL_CHARS,
          "[missing URL]"
        )}`
      );
    }
  }

  lines.push("", "Parent chain context (oldest -> newest):");

  if (selectedAncestors.length === 0) {
    lines.push("- none (the target comment replies directly to the post)");
  } else {
    for (const ancestor of selectedAncestors) {
      const ancestorLabel = getParticipantLabel(
        ancestor.comment.authorId,
        ancestor.comment.authorName,
        ancestor.comment.id
      );
      lines.push(`- relation: ${describeAncestorRelation(ancestor.distanceFromTarget)}`);
      lines.push(`  author: ${ancestorLabel}`);
      lines.push(
        `  text: ${sanitizePromptSegment(
          ancestor.comment.body,
          MAX_ANCESTOR_COMMENT_CONTEXT_CHARS,
          "[empty comment]"
        )}`
      );
    }
  }

  if (omittedAncestorCount > 0) {
    lines.push(
      `- note: ${omittedAncestorCount} middle ancestor comment(s) omitted for brevity`
    );
  }
  if (truncatedByFetchLimit) {
    lines.push(
      `- note: ancestors above ${MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH} levels were not fetched`
    );
  }

  lines.push(
    "",
    "Target comment (this is the item to moderate):",
    `- author: ${targetAuthorLabel}`,
    `- text: ${sanitizePromptSegment(
      targetComment.body,
      MAX_TARGET_COMMENT_CONTEXT_CHARS,
      "[empty comment]"
    )}`
  );

  return sanitizeUntrustedText(lines.join("\n"), MAX_CONTENT_CHARS);
}

/**
 * Walks up the reply chain and returns parent comments nearest-first.
 */
async function fetchCommentAncestors(
  reddit: RedditAPIClient,
  targetComment: PromptContextComment
): Promise<{
  ancestorsClosestFirst: PromptContextComment[];
  truncatedByFetchLimit: boolean;
}> {
  const ancestorsClosestFirst: PromptContextComment[] = [];
  const seenCommentIds = new Set<string>([targetComment.id]);
  let currentComment = targetComment;
  let fetchedCount = 0;

  while (
    fetchedCount < MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH &&
    currentComment.parentId.startsWith("t1_")
  ) {
    const parentId = currentComment.parentId;
    if (seenCommentIds.has(parentId)) {
      break;
    }
    seenCommentIds.add(parentId);

    try {
      const parentComment = await reddit.getCommentById(parentId);
      const parentSnapshot = toPromptContextComment(parentComment);
      ancestorsClosestFirst.push(parentSnapshot);
      currentComment = parentSnapshot;
      fetchedCount += 1;
    } catch (error) {
      console.warn(
        `Could not fetch parent comment ${parentId} while building context for ${targetComment.id}`,
        error
      );
      break;
    }
  }

  return {
    ancestorsClosestFirst,
    truncatedByFetchLimit:
      fetchedCount >= MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH &&
      currentComment.parentId.startsWith("t1_"),
  };
}

/**
 * Keeps root + newest ancestors when the chain is too long for prompt context.
 */
function selectAncestorsForPrompt(
  ancestorsOldestToNewest: AncestorContextEntry[]
): {
  selectedAncestors: AncestorContextEntry[];
  omittedAncestorCount: number;
} {
  if (ancestorsOldestToNewest.length <= MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT) {
    return {
      selectedAncestors: ancestorsOldestToNewest,
      omittedAncestorCount: 0,
    };
  }

  const newestSlots = Math.max(1, MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT - 1);
  const rootAncestor = ancestorsOldestToNewest[0];
  const newestAncestors = ancestorsOldestToNewest.slice(-newestSlots);
  const selectedAncestors = [rootAncestor, ...newestAncestors];

  return {
    selectedAncestors,
    omittedAncestorCount: ancestorsOldestToNewest.length - selectedAncestors.length,
  };
}

/**
 * Returns a stable anonymized participant label for each unique author key.
 */
function createParticipantLabeler(): (
  authorId: string | undefined,
  authorName: string,
  sourceId: string
) => string {
  const labelsByAuthorKey = new Map<string, string>();
  let nextLabelNumber = 1;

  return (authorId, authorName, sourceId) => {
    const authorKey = buildParticipantKey(authorId, authorName, sourceId);
    const existingLabel = labelsByAuthorKey.get(authorKey);
    if (existingLabel != null) {
      return existingLabel;
    }

    const newLabel = `User_${nextLabelNumber}`;
    nextLabelNumber += 1;
    labelsByAuthorKey.set(authorKey, newLabel);
    return newLabel;
  };
}

/**
 * Computes a local, anonymized key for linking contributions by author.
 */
function buildParticipantKey(
  authorId: string | undefined,
  authorName: string,
  sourceId: string
): string {
  if (authorId != null && authorId.trim().length > 0) {
    return `id:${authorId.trim().toLowerCase()}`;
  }

  const normalizedAuthorName = authorName.trim().toLowerCase();
  if (normalizedAuthorName.length > 0 && normalizedAuthorName !== "[deleted]") {
    return `name:${normalizedAuthorName}`;
  }

  return `unknown:${sourceId}`;
}

/**
 * Converts a comment-like object into a context snapshot.
 */
function toPromptContextComment(comment: {
  id: string;
  parentId: string;
  postId: string;
  authorId?: string;
  authorName: string;
  body: string;
}): PromptContextComment {
  return {
    id: comment.id,
    parentId: comment.parentId,
    postId: comment.postId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
  };
}

/**
 * Converts a post-like object into a context snapshot.
 */
function toPromptContextPost(post: {
  id: string;
  authorId?: string;
  authorName: string;
  title: string;
  body?: string;
  url: string;
}): PromptContextPost {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    title: post.title,
    body: post.body,
    url: post.url,
  };
}

/**
 * Describes ancestor relationship labels relative to the target comment.
 */
function describeAncestorRelation(distanceFromTarget: number): string {
  if (distanceFromTarget === 1) {
    return "parent";
  }
  if (distanceFromTarget === 2) {
    return "grandparent";
  }
  if (distanceFromTarget === 3) {
    return "great-grandparent";
  }

  return `ancestor (${distanceFromTarget} levels above target)`;
}

/**
 * Sanitizes a context segment for safe prompt inclusion with a fallback value.
 */
function sanitizePromptSegment(
  value: string | undefined,
  maxChars: number,
  emptyFallback: string
): string {
  const sanitized = sanitizeUntrustedText(value ?? "", maxChars);
  return sanitized.length > 0 ? sanitized : emptyFallback;
}

/**
 * Builds the user-facing removal reply posted as a moderator comment.
 */
function buildRemovalReply(
  type: ContributionType,
  subredditName: string,
  reason: RemovalReason,
  justification: string
): string {
  const safeSubredditName = sanitizeUntrustedText(subredditName, 128);
  const contactUrl = `https://www.reddit.com/message/compose?to=r/${encodeURIComponent(
    safeSubredditName
  )}`;
  const safeReasonTitle = toSingleLine(sanitizeUntrustedText(reason.title, 256));
  const safeReasonMessage = sanitizeUntrustedText(reason.message, 2_000);
  const safeJustification = sanitizeModelJustification(justification, 600);

  const reply = [
    `Your ${type} has been removed.`,
    "",
    `**Rule violated:** ${safeReasonTitle}`,
    "",
    safeReasonMessage,
    "",
    `**Why this was removed:** ${safeJustification}`,
    "",
    `_If you believe this is a mistake, please [contact the moderators](${contactUrl})._`,
  ].join("\n");

  return truncate(reply, MAX_REPLY_CHARS);
}

/**
 * Extracts and normalizes candidate image URLs from a post for vision analysis.
 */
function extractPostImageUrls(post: {
  url: string;
  gallery: Array<{ url: string }>;
  thumbnail?: { url: string } | undefined;
  secureMedia?: { oembed?: { thumbnailUrl?: string } } | undefined;
}): string[] {
  const rawCandidates = [
    post.url,
    ...post.gallery.map((media) => media.url),
    post.thumbnail?.url,
    post.secureMedia?.oembed?.thumbnailUrl,
  ];

  const deduped = new Set<string>();
  for (const candidate of rawCandidates) {
    if (candidate == null) {
      continue;
    }

    const normalized = normalizeImageUrl(candidate);
    if (normalized == null) {
      continue;
    }

    deduped.add(normalized);
    if (deduped.size >= MAX_VISION_IMAGES) {
      break;
    }
  }

  return Array.from(deduped);
}

/**
 * Normalizes a candidate URL and keeps only URLs that are likely image assets.
 */
function normalizeImageUrl(urlValue: string): string | null {
  const trimmed = urlValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const sanitized = trimmed.replace(/&amp;/g, "&");
  const withScheme = sanitized.startsWith("//") ? `https:${sanitized}` : sanitized;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed = appendJpegExtensionToRedditImageUrl(parsed);

  if (!isLikelyImageUrl(parsed)) {
    return null;
  }

  return parsed.toString();
}

/**
 * Appends a `.jpeg` extension to Reddit image URLs when no file extension is present.
 */
function appendJpegExtensionToRedditImageUrl(url: URL): URL {
  const host = url.hostname.toLowerCase();
  if (
    host !== "i.redd.it" &&
    host !== "preview.redd.it" &&
    host !== "external-preview.redd.it"
  ) {
    return url;
  }

  const hasExtension = /\.[a-z0-9]+$/i.test(url.pathname);
  if (hasExtension || url.pathname.endsWith("/")) {
    return url;
  }

  const updated = new URL(url.toString());
  updated.pathname = `${updated.pathname}.jpeg`;
  return updated;
}

/**
 * Heuristic check for URLs that likely point to an image resource.
 */
function isLikelyImageUrl(url: URL): boolean {
  const imageExtensionPattern =
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
  if (imageExtensionPattern.test(url.pathname)) {
    return true;
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "i.redd.it" ||
    host === "preview.redd.it" ||
    host === "external-preview.redd.it" ||
    host === "i.imgur.com" ||
    host.endsWith(".redd.it")
  ) {
    return true;
  }

  const formatParam = url.searchParams.get("format")?.toLowerCase();
  if (
    formatParam === "jpg" ||
    formatParam === "jpeg" ||
    formatParam === "png" ||
    formatParam === "webp"
  ) {
    return true;
  }

  return false;
}
