import { ReasoningEffort } from "openai/resources.js";

/**
 * Application constants module.
 *
 * This module centralizes setting keys, model identifiers, and bounded text
 * limits used throughout moderation.
 */
export const OPENAI_API_KEY_SETTING = "openai-api-key";
export const AUTO_ENFORCE_CONFIDENCE_THRESHOLD_SETTING =
  "auto-enforce-confidence-threshold";
export const RULE_INTERPRETATION_CONTEXT_SETTING =
  "rule-interpretation-context";
export const REFERENCE_LINKS_SETTING = "reference-links";

export const OPENAI_MODEL = "gpt-5.4";
export const OPENAI_REASONING_EFFORT : ReasoningEffort = "medium";
export const BOT_USERNAME_FALLBACK = "stickler-bot";
export const DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD = 0.8;

export const MAX_CONTENT_CHARS = 6_000;
export const MAX_REASON_CHARS = 1_200;
export const MAX_JUSTIFICATION_CHARS = 900;
export const MAX_REPLY_CHARS = 9_000;
export const MAX_VISION_IMAGES = 4;
export const MAX_RULE_INTERPRETATION_CONTEXT_CHARS = 4_000;
export const MAX_REFERENCE_LINKS_SETTING_CHARS = 4_000;
export const MAX_REFERENCE_LINKS = 5;
