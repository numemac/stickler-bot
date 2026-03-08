import type { RemovalReason } from "@devvit/public-api";

/**
 * Marker moderators can append to a removal reason title/message to disable
 * bot enforcement for that specific reason.
 */
export const AUTO_ENFORCEMENT_DISABLED_MARKER = "[~!~!~]";

export type EnforceableRemovalReason = {
  originalIndex: number;
  reason: RemovalReason;
};

/**
 * Returns true when a removal reason is explicitly excluded from bot enforcement.
 */
export function isAutoEnforcementDisabledReason(
  reason: Pick<RemovalReason, "title" | "message">
): boolean {
  const title = reason.title ?? "";
  const message = reason.message ?? "";

  return (
    title.includes(AUTO_ENFORCEMENT_DISABLED_MARKER) ||
    message.includes(AUTO_ENFORCEMENT_DISABLED_MARKER)
  );
}

/**
 * Returns enforceable removal reasons while preserving each source index.
 */
export function selectEnforceableRemovalReasons(
  removalReasons: readonly RemovalReason[]
): EnforceableRemovalReason[] {
  return removalReasons
    .map((reason, originalIndex) => ({
      originalIndex,
      reason,
    }))
    .filter((entry) => !isAutoEnforcementDisabledReason(entry.reason));
}
