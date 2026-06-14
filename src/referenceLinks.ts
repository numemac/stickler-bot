import {
  MAX_REFERENCE_LINKS,
  MAX_REFERENCE_LINKS_SETTING_CHARS,
} from "./constants.js";
import { sanitizeUntrustedText, toSingleLine } from "./text.js";
import type { ReferenceLink } from "./types.js";

export type ReferenceLinksParseResult =
  | { ok: true; referenceLinks: ReferenceLink[] }
  | { ok: false; error: string };

const JSON_ARRAY_ERROR =
  "Reference Links must be a valid JSON array of objects.";
const MAX_LENGTH_ERROR = `Reference Links must be ${MAX_REFERENCE_LINKS_SETTING_CHARS} characters or less.`;
const MAX_LINKS_ERROR = `Reference Links supports at most ${MAX_REFERENCE_LINKS} entries.`;
const LABEL_ERROR =
  "Each Reference Link must have a non-empty label of 120 characters or less.";
const URL_ERROR =
  "Each Reference Link must have a valid https:// URL of 500 characters or less.";
const USE_WHEN_ERROR =
  "Each Reference Link must have a non-empty use_when value of 500 characters or less.";

/**
 * Parses and normalizes optional configured reference links.
 */
export function parseReferenceLinks(value: unknown): ReferenceLinksParseResult {
  if (value == null) {
    return { ok: true, referenceLinks: [] };
  }

  if (typeof value !== "string") {
    return { ok: false, error: JSON_ARRAY_ERROR };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, referenceLinks: [] };
  }

  if (trimmed.length > MAX_REFERENCE_LINKS_SETTING_CHARS) {
    return { ok: false, error: MAX_LENGTH_ERROR };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: JSON_ARRAY_ERROR };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: JSON_ARRAY_ERROR };
  }

  if (parsed.length > MAX_REFERENCE_LINKS) {
    return { ok: false, error: MAX_LINKS_ERROR };
  }

  const referenceLinks: ReferenceLink[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      return { ok: false, error: JSON_ARRAY_ERROR };
    }

    const label = parseBoundedSingleLineString(
      entry["label"],
      120,
      LABEL_ERROR
    );
    if (!label.ok) {
      return { ok: false, error: label.error };
    }

    const url = parseReferenceUrl(entry["url"]);
    if (!url.ok) {
      return { ok: false, error: url.error };
    }

    const useWhen = parseBoundedSingleLineString(
      entry["use_when"] ?? entry["useWhen"],
      500,
      USE_WHEN_ERROR
    );
    if (!useWhen.ok) {
      return { ok: false, error: useWhen.error };
    }

    referenceLinks.push({
      label: label.value,
      url: url.value,
      useWhen: useWhen.value,
    });
  }

  return { ok: true, referenceLinks };
}

/**
 * Adapter for Devvit setting validation.
 */
export function validateReferenceLinksSetting(
  value: unknown
): string | undefined {
  const result = parseReferenceLinks(value);
  return result.ok ? undefined : result.error;
}

function parseBoundedSingleLineString(
  value: unknown,
  maxChars: number,
  error: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error };
  }

  const sanitized = toSingleLine(
    sanitizeUntrustedText(value, Number.MAX_SAFE_INTEGER)
  );
  if (sanitized.length === 0 || sanitized.length > maxChars) {
    return { ok: false, error };
  }

  return { ok: true, value: sanitized };
}

function parseReferenceUrl(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: URL_ERROR };
  }

  const sanitized = toSingleLine(
    sanitizeUntrustedText(value, Number.MAX_SAFE_INTEGER)
  );
  if (sanitized.length === 0 || sanitized.length > 500) {
    return { ok: false, error: URL_ERROR };
  }

  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    return { ok: false, error: URL_ERROR };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: URL_ERROR };
  }

  parsed.hash = "";
  return { ok: true, value: parsed.toString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
