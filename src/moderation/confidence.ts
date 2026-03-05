/**
 * Formats confidence values as fixed precision percentages for logs and notices.
 */
export function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(1)}%`;
}
