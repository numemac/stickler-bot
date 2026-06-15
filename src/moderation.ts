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
import type { RuleInterpretationContext } from "./ruleInterpretationContext.js";
import type {
  ContributionType,
  ModerationOutcome,
  ReferenceLink,
} from "./types.js";
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
import {
  AUTO_ENFORCEMENT_DISABLED_MARKER,
  selectEnforceableRemovalReasons,
} from "./moderation/removalReasonToggle.js";
import { buildRemovalReply } from "./moderation/removalReply.js";
import { evaluateDecisionSafety } from "./moderation/decisionSafety.js";
import {
  createModerationLogger,
  formatModerationOutcomeSummary,
  type ModerationLogger,
} from "./moderation/logging.js";
import { sendTriageModmail } from "./moderation/triage.js";

const inFlightModerations = new Set<string>();

type ModerateContributionDeps = {
  fetchContribution: typeof fetchContribution;
  fetchSubredditDescription: (
    reddit: RedditAPIClient,
    subredditName: string,
    logger?: ModerationLogger
  ) => Promise<string | undefined>;
  buildLLMPrompt: typeof buildLLMPrompt;
  getOpenAIResponse: typeof getOpenAIResponse;
  sendTriageModmail: typeof sendTriageModmail;
  buildRemovalReply: typeof buildRemovalReply;
  now: () => string;
};

/**
 * Resolves dependency overrides for deterministic unit testing.
 */
function resolveModerationDeps(
  overrides: Partial<ModerateContributionDeps>
): ModerateContributionDeps {
  return {
    fetchContribution,
    fetchSubredditDescription,
    buildLLMPrompt,
    getOpenAIResponse,
    sendTriageModmail,
    buildRemovalReply,
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Runs end-to-end moderation for a single post or comment.
 */
export async function moderateContribution(
  reddit: RedditAPIClient,
  openaiApiKey: string,
  contributionId: string,
  type: ContributionType,
  autoEnforceConfidenceThreshold: number,
  depsOverrides: Partial<ModerateContributionDeps> = {},
  ruleInterpretationContext?: RuleInterpretationContext,
  referenceLinks: ReferenceLink[] = []
): Promise<ModerationOutcome> {
  const moderationKey = `${type}:${contributionId}`;
  const logger = createModerationLogger(moderationKey);
  if (inFlightModerations.has(moderationKey)) {
    const duplicateOutcome: ModerationOutcome = { status: "no-removal-reason" };
    logger.log("Skipping duplicate in-flight moderation");
    logger.log(formatModerationOutcomeSummary(duplicateOutcome));
    return duplicateOutcome;
  }

  inFlightModerations.add(moderationKey);
  const deps = resolveModerationDeps(depsOverrides);
  let outcome: ModerationOutcome | undefined;
  const complete = (nextOutcome: ModerationOutcome): ModerationOutcome => {
    outcome = nextOutcome;
    return nextOutcome;
  };

  try {
    const botUsername =
      (await reddit.getAppUser())?.username?.toLowerCase() ??
      BOT_USERNAME_FALLBACK;

    const contribution = await deps.fetchContribution(
      reddit,
      contributionId,
      type,
      botUsername
    );
    if (contribution == null) {
      logger.error(`Could not fetch ${type} with id ${contributionId}`);
      return complete({ status: "failed" });
    }

    if (contribution.removed) {
      logger.log("Skipping because it is already removed.");
      return complete({ status: "no-removal-reason" });
    }

    if (contribution.distinguishedBy != null) {
      logger.log("Skipping because it is distinguished.");
      return complete({ status: "no-removal-reason" });
    }

    if (contribution.authorName.toLowerCase() === botUsername) {
      logger.log(
        `Skipping because it was created by the bot (u/${contribution.authorName.toLowerCase()}).`
      );
      return complete({ status: "no-removal-reason" });
    }

    if (contribution.skipModerationReason != null) {
      logger.log(`Skipping: ${contribution.skipModerationReason}`);
      return complete({ status: "no-removal-reason" });
    }

    const removalReasons = await reddit.getSubredditRemovalReasons(
      contribution.subredditName
    );
    if (removalReasons.length === 0) {
      logger.error(
        `Subreddit r/${contribution.subredditName} has no removal reasons configured`
      );
      return complete({ status: "failed" });
    }

    const enforceableRemovalReasons =
      selectEnforceableRemovalReasons(removalReasons);
    const disabledReasonCount =
      removalReasons.length - enforceableRemovalReasons.length;
    if (enforceableRemovalReasons.length === 0) {
      logger.warn(
        `Skipping: all removal reasons are marked with ${AUTO_ENFORCEMENT_DISABLED_MARKER} (auto-enforcement disabled).`
      );
      return complete({ status: "no-removal-reason" });
    }

    if (disabledReasonCount > 0) {
      logger.log(
        `Excluded ${disabledReasonCount} removal reason(s) from LLM classification via marker ${AUTO_ENFORCEMENT_DISABLED_MARKER}.`
      );
    }

    const subredditDescription = await deps.fetchSubredditDescription(
      reddit,
      contribution.subredditName,
      logger
    );
    const currentDateTimeUtc = deps.now();

    const llmPrompt = deps.buildLLMPrompt(
      contribution.subredditName,
      enforceableRemovalReasons.map(({ reason }) => reason),
      contribution.contentForPrompt,
      subredditDescription,
      currentDateTimeUtc,
      ruleInterpretationContext,
      referenceLinks
    );

    const llmDecision = await deps.getOpenAIResponse(
      openaiApiKey,
      llmPrompt,
      enforceableRemovalReasons.length,
      contribution.imageUrls,
      referenceLinks.length,
      logger
    );
    if (llmDecision == null) {
      logger.error("Failed to get a valid moderation decision");
      return complete({ status: "failed" });
    }

    const { removalReasonIndex, justification, confidence, needsHumanReview } =
      llmDecision;
    if (removalReasonIndex === null) {
      logger.log(
        `No violation detected (confidence=${formatConfidence(
          confidence
        )}, needsHumanReview=${needsHumanReview})`
      );
      return complete({ status: "no-removal-reason" });
    }

    const violatedReasonEntry = enforceableRemovalReasons[removalReasonIndex];
    if (violatedReasonEntry == null) {
      logger.error(
        `LLM returned out-of-range removalReasonIndex=${removalReasonIndex} (enforceableReasonCount=${enforceableRemovalReasons.length})`
      );
      return complete({ status: "failed" });
    }
    const violatedReason = violatedReasonEntry.reason;
    const violatedReasonSourceIndex = violatedReasonEntry.originalIndex;
    const decisionSafety = evaluateDecisionSafety(
      violatedReason,
      llmDecision.evidence,
      contribution.imageUrls.length > 0
    );
    const effectiveNeedsHumanReview =
      needsHumanReview || decisionSafety.forceHumanReview;
    const humanReviewSkipReason = decisionSafety.skipReason ?? "needs-human-review";

    if (effectiveNeedsHumanReview) {
      await deps.sendTriageModmail(
        reddit,
        contribution,
        type,
        violatedReason,
        justification,
        confidence,
        autoEnforceConfidenceThreshold,
        effectiveNeedsHumanReview,
        humanReviewSkipReason
      );
      logger.log(
        `Flagged for human review (${humanReviewSkipReason}): reason [${violatedReasonSourceIndex}] ${violatedReason.title} (confidence=${formatConfidence(
          confidence
        )}, threshold=${formatConfidence(autoEnforceConfidenceThreshold)})`
      );
      return complete({
        status: "triaged",
        removalReasonTitle: violatedReason.title,
      });
    }

    if (confidence < autoEnforceConfidenceThreshold) {
      await deps.sendTriageModmail(
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
      logger.log(
        `Not auto-enforcing: confidence ${formatConfidence(
          confidence
        )} below threshold ${formatConfidence(autoEnforceConfidenceThreshold)} for reason [${violatedReasonSourceIndex}] ${violatedReason.title}`
      );
      return complete({
        status: "triaged",
        removalReasonTitle: violatedReason.title,
      });
    }

    const replyText = deps.buildRemovalReply(
      type,
      contribution.subredditName,
      violatedReason,
      justification,
      llmDecision.referenceLinkIndex == null
        ? undefined
        : referenceLinks[llmDecision.referenceLinkIndex]
    );

    try {
      const reply = await reddit.submitComment({
        id: contribution.id,
        text: replyText,
        runAs: "APP",
      });

      // Do not sticky if the contribution is a comment
      reply.distinguish(type == "post" ? true : false);

      logger.log(
        `Posted removal comment ${reply.id} for reason [${violatedReasonSourceIndex}] ${violatedReason.title}`
      );
    } catch (error) {
      logger.error("Failed to post removal comment", error);
    }

    await reddit.remove(contribution.id, false);
    logger.log(
      `Removed for reason [${violatedReasonSourceIndex}] ${violatedReason.title}`
    );

    return complete({
      status: "removed",
      removalReasonTitle: violatedReason.title,
    });
  } catch (error) {
    logger.error("Unexpected moderation failure", error);
    return complete({ status: "failed" });
  } finally {
    if (outcome != null) {
      logger.log(formatModerationOutcomeSummary(outcome));
    }
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
  subredditName: string,
  logger?: ModerationLogger
): Promise<string | undefined> {
  try {
    const subredditInfo : SubredditInfo = await reddit.getSubredditInfoByName(subredditName);
    const description = subredditInfo.description?.markdown?.trim();
    return description != null && description.length > 0 ? description : undefined;
  } catch (error) {
    const message =
      `Could not fetch subreddit description for r/${subredditName}; continuing without it.`;
    if (logger == null) {
      console.warn(message, error);
    } else {
      logger.warn(message, error);
    }
    return undefined;
  }
}
