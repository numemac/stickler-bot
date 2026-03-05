import { type RemovalReason } from "@devvit/public-api";

import { MAX_JUSTIFICATION_CHARS, MAX_REPLY_CHARS } from "../constants.js";
import {
  sanitizePublicRemovalJustification,
  sanitizeUntrustedText,
  toSingleLine,
  truncate,
} from "../text.js";
import type { ContributionType } from "../types.js";

/**
 * Builds the user-facing removal reply posted as a moderator comment.
 */
export function buildRemovalReply(
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
  const safeJustification = sanitizePublicRemovalJustification(
    justification,
    MAX_JUSTIFICATION_CHARS
  );

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
