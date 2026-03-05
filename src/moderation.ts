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

/**
 * Runs end-to-end moderation for a single post or comment.
 */
export async function moderateContribution(
  reddit: RedditAPIClient,
  openaiApiKey: string,
  contributionId: string,
  type: ContributionType
): Promise<boolean> {
  const moderationKey = `${type}:${contributionId}`;
  if (inFlightModerations.has(moderationKey)) {
    console.log(`Skipping duplicate in-flight moderation for ${moderationKey}`);
    return true;
  }

  inFlightModerations.add(moderationKey);

  try {
    const contribution = await fetchContribution(reddit, contributionId, type);
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

    const botUsername =
      (await reddit.getCurrentUser())?.username?.toLowerCase() ??
      BOT_USERNAME_FALLBACK;
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

    const { removalReasonIndex, justification } = llmDecision;
    if (removalReasonIndex === null) {
      console.log(`No violation detected for ${moderationKey}`);
      return true;
    }

    const violatedReason = removalReasons[removalReasonIndex];
    if (violatedReason == null) {
      console.error(
        `LLM returned out-of-range removalReasonIndex=${removalReasonIndex} for ${moderationKey}`
      );
      return false;
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
 * Fetches a contribution and normalizes it into a shared structure for prompt
 * generation and moderation decisions.
 */
async function fetchContribution(
  reddit: RedditAPIClient,
  contributionId: string,
  type: ContributionType
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

  return {
    id: comment.id,
    authorName: comment.authorName,
    subredditName: sanitizeUntrustedText(comment.subredditName, 128),
    contentForPrompt: sanitizeUntrustedText(comment.body, MAX_CONTENT_CHARS),
    imageUrls: [],
    distinguishedBy: comment.distinguishedBy,
    removed: comment.removed,
  };
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
