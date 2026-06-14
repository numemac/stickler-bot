import {
  MAX_RULE_INTERPRETATION_CONTEXT_CHARS,
} from "./constants.js";
import { sanitizeUntrustedText } from "./text.js";

export type RuleInterpretationContext = Record<string, unknown>;

export type RuleInterpretationContextParseResult =
  | { ok: true; context?: RuleInterpretationContext }
  | { ok: false; error: string };

const JSON_OBJECT_ERROR =
  "Rule Interpretation Context must be a valid JSON object.";
const MAX_LENGTH_ERROR = `Rule Interpretation Context must be ${MAX_RULE_INTERPRETATION_CONTEXT_CHARS} characters or less.`;

/**
 * Parses and normalizes the optional rule interpretation context setting.
 */
export function parseRuleInterpretationContext(
  value: unknown
): RuleInterpretationContextParseResult {
  if (value == null) {
    return { ok: true };
  }

  if (typeof value !== "string") {
    return { ok: false, error: JSON_OBJECT_ERROR };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true };
  }

  if (trimmed.length > MAX_RULE_INTERPRETATION_CONTEXT_CHARS) {
    return { ok: false, error: MAX_LENGTH_ERROR };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: JSON_OBJECT_ERROR };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: JSON_OBJECT_ERROR };
  }

  const sanitizedParsed = sanitizeJsonValue(parsed);
  if (!isRecord(sanitizedParsed)) {
    return { ok: false, error: JSON_OBJECT_ERROR };
  }

  const normalized = JSON.stringify(sanitizedParsed, null, 2);
  if (normalized.length > MAX_RULE_INTERPRETATION_CONTEXT_CHARS) {
    return { ok: false, error: MAX_LENGTH_ERROR };
  }

  if (normalized.length === 0) {
    return { ok: true };
  }

  return {
    ok: true,
    context: sanitizedParsed,
  };
}

/**
 * Adapter for Devvit setting validation.
 */
export function validateRuleInterpretationContextSetting(
  value: unknown
): string | undefined {
  const result = parseRuleInterpretationContext(value);
  return result.ok ? undefined : result.error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeUntrustedText(value, Number.MAX_SAFE_INTEGER);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitizedKey = sanitizeUntrustedText(
        key,
        Number.MAX_SAFE_INTEGER
      );
      if (sanitizedKey.length === 0) {
        continue;
      }

      output[sanitizedKey] = sanitizeJsonValue(entry);
    }

    return output;
  }

  return value;
}
