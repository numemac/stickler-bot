import type { RemovalReason } from "@devvit/public-api";

/**
 * Marker moderators can append to a removal reason title/message to disable
 * bot enforcement for that specific reason.
 */
export const AUTO_ENFORCEMENT_DISABLED_MARKER = "[~!]";
/**
 * Marker moderators can append to a removal reason title/message to require
 * direct evidence metadata before auto-enforcement.
 */
export const EVIDENCE_REQUIRED_MARKER = "[~?]";

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
 * Returns true when a removal reason requires direct evidence to auto-enforce.
 */
export function isEvidenceRequiredReason(
  reason: Pick<RemovalReason, "title" | "message">
): boolean {
  const marker = EVIDENCE_REQUIRED_MARKER.toLowerCase();
  const title = (reason.title ?? "").toLowerCase();
  const message = (reason.message ?? "").toLowerCase();

  return title.includes(marker) || message.includes(marker);
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
