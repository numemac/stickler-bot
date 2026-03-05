/**
 * Shared text utility module.
 *
 * This module contains small formatting helpers used across prompt and reply
 * generation.
 */
/**
 * Truncates a string to a maximum character count, appending an ellipsis when
 * truncation occurs.
 */
export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

/**
 * Collapses all whitespace and returns a trimmed single-line string.
 */
export function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Sanitizes untrusted text to reduce prompt-injection tricks and control-character abuse.
 */
export function sanitizeUntrustedText(value: string, maxChars: number): string {
  const withoutControls = value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "");

  const trimmed = withoutControls.trim();
  return truncate(trimmed, maxChars);
}

/**
 * Sanitizes model-generated justification before posting user-visible moderation replies.
 */
export function sanitizeModelJustification(value: string, maxChars: number): string {
  const base = sanitizeUntrustedText(value, maxChars);

  // Prevent link-injection and formatting abuse in public moderator replies.
  return base
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[`*_>#~]/g, "");
}

/**
 * Sanitizes public-facing removal justifications and strips direct quoted snippets.
 */
export function sanitizePublicRemovalJustification(
  value: string,
  maxChars: number
): string {
  const expandedLimit = Math.max(maxChars * 2, maxChars);
  const withoutBlockquotes = sanitizeUntrustedText(value, expandedLimit)
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join(" ");
  const base = sanitizeModelJustification(withoutBlockquotes, expandedLimit);
  const withoutQuotedSnippets = base
    .replace(/“[^”\n]{1,280}”/g, "")
    .replace(/"[^"\n]{1,280}"/g, "")
    .replace(/‘[^’\n]{1,280}’/g, "")
    .replace(/`[^`\n]{1,280}`/g, "");
  const cleaned = toSingleLine(
    withoutQuotedSnippets
      .replace(/[“”‘’"`]/g, "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s*\)/g, "")
  );

  if (cleaned.length === 0) {
    return truncate(
      "This was removed because it appears to break a subreddit rule. If you think this is a mistake, please message the mod team and we will review.",
      maxChars
    );
  }

  return truncate(cleaned, maxChars);
}
