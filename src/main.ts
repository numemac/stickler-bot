/**
 * Application entrypoint module.
 *
 * This module wires Devvit configuration, installation settings, and trigger
 * registration, then delegates moderation behavior to the moderation service.
 */
import { Devvit, SettingScope } from "@devvit/public-api";

import {
  AUTO_ENFORCE_CONFIDENCE_THRESHOLD_SETTING,
  DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD,
  OPENAI_API_KEY_SETTING,
} from "./constants.js";
import { moderateContribution } from "./moderation.js";

Devvit.configure({
  redditAPI: true,
  http: {
    domains: ["api.openai.com"],
  },
});

Devvit.addSettings([
  {
    name: OPENAI_API_KEY_SETTING,
    type: "string",
    label: "OpenAI API Key",
    defaultValue: "",
    scope: SettingScope.Installation,
  },
  {
    name: AUTO_ENFORCE_CONFIDENCE_THRESHOLD_SETTING,
    type: "number",
    label: "Auto-Enforce Confidence Threshold (0 to 1)",
    defaultValue: DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD,
    scope: SettingScope.Installation,
    onValidate({ value }) {
      if (value == null) {
        return;
      }

      if (value < 0 || value > 1) {
        return "Threshold must be between 0 and 1.";
      }
    },
  },
]);

/**
 * Trigger registration for newly submitted posts.
 */
Devvit.addTrigger({
  event: "PostSubmit",
  /**
   * Handles each post submission event and dispatches it to moderation.
   */
  async onEvent(event, context) {
    const post = event.post;
    if (post == null) {
      console.error("PostSubmit event is missing the post object");
      return;
    }

    const openaiApiKey = await readOpenAIApiKey(context);
    const autoEnforceThreshold = await readAutoEnforceConfidenceThreshold(context);
    await moderateContribution(
      context.reddit,
      openaiApiKey,
      post.id,
      "post",
      autoEnforceThreshold
    );
  },
});

/**
 * Trigger registration for reported comments.
 */
Devvit.addTrigger({
  event: "CommentReport",
  /**
   * Handles each comment report event and dispatches it to moderation.
   */
  async onEvent(event, context) {
    const comment = event.comment;
    if (comment == null) {
      console.error("CommentReport event is missing the comment object");
      return;
    }

    const openaiApiKey = await readOpenAIApiKey(context);
    const autoEnforceThreshold = await readAutoEnforceConfidenceThreshold(context);
    await moderateContribution(
      context.reddit,
      openaiApiKey,
      comment.id,
      "comment",
      autoEnforceThreshold
    );
  },
});

/**
 * Reads the configured OpenAI API key from installation settings.
 */
async function readOpenAIApiKey(context: { settings: { get(name: string): Promise<unknown> } }): Promise<string> {
  const rawValue = await context.settings.get(OPENAI_API_KEY_SETTING);
  return typeof rawValue === "string" ? rawValue : "";
}

/**
 * Reads and normalizes the auto-enforcement confidence threshold setting.
 */
async function readAutoEnforceConfidenceThreshold(context: {
  settings: { get(name: string): Promise<unknown> };
}): Promise<number> {
  const rawValue = await context.settings.get(
    AUTO_ENFORCE_CONFIDENCE_THRESHOLD_SETTING
  );

  const parsed =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? Number(rawValue)
        : DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD;
  }

  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }

  return parsed;
}

export default Devvit;
