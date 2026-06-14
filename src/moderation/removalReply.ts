import { type RemovalReason } from "@devvit/public-api";

import { MAX_JUSTIFICATION_CHARS, MAX_REPLY_CHARS } from "../constants.js";
import {
  sanitizePublicRemovalJustification,
  sanitizeUntrustedText,
  toSingleLine,
  truncate,
} from "../text.js";
import type { ContributionType, ReferenceLink } from "../types.js";

/**
 * Builds the user-facing removal reply posted as a moderator comment.
 */
export function buildRemovalReply(
  type: ContributionType,
  subredditName: string,
  reason: RemovalReason,
  justification: string,
  referenceLink?: ReferenceLink
): string {
  const safeSubredditName = sanitizeUntrustedText(subredditName, 128);
  const contactUrl = `https://www.reddit.com/message/compose?to=r/${encodeURIComponent(
    safeSubredditName
  )}`;
  const safeReasonTitle = toSingleLine(sanitizeUntrustedText(reason.title, 256));
  const safeJustification = sanitizePublicRemovalJustification(
    justification,
    MAX_JUSTIFICATION_CHARS
  );
  const referenceMarkdown = formatReferenceMarkdown(referenceLink);

  const reply = [
    `Your ${type} has been removed.`,
    "",
    `**Rule applied:** ${safeReasonTitle}`,
    "",
    `**Why this was removed:**`,
    safeJustification,
    ...(referenceMarkdown == null ? [] : ["", `Related: ${referenceMarkdown}`]),
    "",
    `_If you believe this is a mistake, please [contact the moderators](${contactUrl})._`,
  ].join("\n");

  return truncate(reply, MAX_REPLY_CHARS);
}

function formatReferenceMarkdown(referenceLink: ReferenceLink | undefined): string | undefined {
  if (referenceLink == null) {
    return undefined;
  }

  const safeLabel = escapeMarkdownLinkLabel(
    toSingleLine(sanitizeUntrustedText(referenceLink.label, 120))
  );
  if (safeLabel.length === 0) {
    return undefined;
  }

  const safeUrl = normalizeMarkdownUrl(referenceLink.url);
  if (safeUrl == null) {
    return undefined;
  }

  return `[${safeLabel}](${safeUrl})`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function normalizeMarkdownUrl(value: string): string | undefined {
  const sanitized = toSingleLine(sanitizeUntrustedText(value, 500));
  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:") {
    return undefined;
  }

  parsed.hash = "";
  return parsed.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
}
