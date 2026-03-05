import { type RedditAPIClient, type RemovalReason } from "@devvit/public-api";

import {
  sanitizeModelJustification,
  sanitizeUntrustedText,
  toSingleLine,
  truncate,
} from "../text.js";
import type { Contribution, ContributionType } from "../types.js";
import { formatConfidence } from "./confidence.js";

const triageModmailSentAt = new Map<string, number>();
const MAX_TRIAGE_MODMAIL_SUBJECT_CHARS = 100;
const MAX_TRIAGE_MODMAIL_BODY_CHARS = 8_000;
const TRIAGE_MODMAIL_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const TRIAGE_MODMAIL_CACHE_MAX_ENTRIES = 5_000;

export type TriageSkipReason = "needs-human-review" | "below-threshold";

/**
 * Sends a modmail triage notice when auto-enforcement is skipped.
 */
export async function sendTriageModmail(
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
