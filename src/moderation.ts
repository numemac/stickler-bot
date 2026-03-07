/**
 * Moderation orchestration module.
 *
 * This module owns trigger-level moderation flow and delegates specific
 * responsibilities (context building, media handling, triage, and replies)
 * to focused modules under ./moderation.
 */
import { SubredditInfo, type RedditAPIClient } from "@devvit/public-api";

import { BOT_USERNAME_FALLBACK } from "./constants.js";
import { buildLLMPrompt, getOpenAIResponse } from "./llm.js";
import type { ContributionType } from "./types.js";
import {
  buildCommentContextForPrompt,
  buildParticipantKey,
  createParticipantLabeler,
  selectAncestorsForPrompt,
} from "./moderation/commentContext.js";
import { formatConfidence } from "./moderation/confidence.js";
import { fetchContribution } from "./moderation/contribution.js";
import {
  hasSubstantialVideoBodyText,
  isRedditVideoUploadPost,
} from "./moderation/postMedia.js";
import { buildRemovalReply } from "./moderation/removalReply.js";
import { sendTriageModmail } from "./moderation/triage.js";

const inFlightModerations = new Set<string>();

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

    if (contribution.skipModerationReason != null) {
      console.log(
        `Skipping ${moderationKey}: ${contribution.skipModerationReason}`
      );
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

    const subredditDescription = await fetchSubredditDescription(
      reddit,
      contribution.subredditName
    );

    const llmPrompt = buildLLMPrompt(
      contribution.subredditName,
      removalReasons,
      contribution.contentForPrompt,
      subredditDescription
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

      // Do not sticky if the contribution is a comment
      reply.distinguish(type == "post" ? true : false);

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
 * Exported internals for focused unit tests.
 */
export const __moderationTestables = {
  buildCommentContextForPrompt,
  selectAncestorsForPrompt,
  createParticipantLabeler,
  buildParticipantKey,
  hasSubstantialVideoBodyText,
  isRedditVideoUploadPost,
};

/**
 * Fetches subreddit description text used as additional context for LLM classification.
 */
async function fetchSubredditDescription(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<string | undefined> {
  try {
    const subredditInfo : SubredditInfo = await reddit.getSubredditInfoByName(subredditName);
    const description = subredditInfo.description?.markdown?.trim();
    return description != null && description.length > 0 ? description : undefined;
  } catch (error) {
    console.warn(
      `Could not fetch subreddit description for r/${subredditName}; continuing without it.`,
      error
    );
    return undefined;
  }
}
