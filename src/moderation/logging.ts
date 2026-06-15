import type { ModerationOutcome } from "../types.js";

export type ModerationLogger = {
  log(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
};

/**
 * Formats moderation logs with stable contribution context and an ISO timestamp.
 */
export function formatModerationLogMessage(
  moderationKey: string,
  message: string,
  timestamp = new Date().toISOString()
): string {
  return `[${moderationKey}] [${timestamp}] ${message}`;
}

/**
 * Creates a console-backed logger scoped to a single contribution.
 */
export function createModerationLogger(
  moderationKey: string
): ModerationLogger {
  return {
    log(message) {
      console.log(formatModerationLogMessage(moderationKey, message));
    },
    warn(message, error) {
      const formattedMessage = formatModerationLogMessage(
        moderationKey,
        message
      );
      if (error === undefined) {
        console.warn(formattedMessage);
        return;
      }

      console.warn(formattedMessage, error);
    },
    error(message, error) {
      const formattedMessage = formatModerationLogMessage(
        moderationKey,
        message
      );
      if (error === undefined) {
        console.error(formattedMessage);
        return;
      }

      console.error(formattedMessage, error);
    },
  };
}

/**
 * Builds the terminal status line emitted for every completed moderation run.
 */
export function formatModerationOutcomeSummary(
  outcome: ModerationOutcome
): string {
  if (outcome.status === "removed" || outcome.status === "triaged") {
    return `Completed moderation (status=${outcome.status}, removalReason="${outcome.removalReasonTitle}")`;
  }

  return `Completed moderation (status=${outcome.status})`;
}
