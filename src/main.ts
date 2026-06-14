/**
 * Application entrypoint module.
 *
 * This module wires Devvit configuration, installation settings, and trigger
 * registration, then delegates moderation behavior to the moderation service.
 */
import { Devvit, SettingScope, MenuItemOnPressEvent } from "@devvit/public-api";
import type { ContributionType, ModerationOutcome } from "./types.js";

import {
  AUTO_ENFORCE_CONFIDENCE_THRESHOLD_SETTING,
  DEFAULT_AUTO_ENFORCE_CONFIDENCE_THRESHOLD,
  OPENAI_API_KEY_SETTING,
  REFERENCE_LINKS_SETTING,
  RULE_INTERPRETATION_CONTEXT_SETTING,
} from "./constants.js";
import { moderateContribution } from "./moderation.js";
import {
  parseReferenceLinks,
  validateReferenceLinksSetting,
} from "./referenceLinks.js";
import {
  parseRuleInterpretationContext,
  validateRuleInterpretationContextSetting,
} from "./ruleInterpretationContext.js";
import type { ReferenceLink } from "./types.js";
import type { RuleInterpretationContext } from "./ruleInterpretationContext.js";

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
  {
    name: RULE_INTERPRETATION_CONTEXT_SETTING,
    type: "paragraph",
    label: "Optional Rule Interpretation Context JSON",
    defaultValue: "",
    scope: SettingScope.Installation,
    helpText:
      "Optional JSON object used to interpret existing Removal Reasons. This does not create new enforceable rules.",
    onValidate({ value }) {
      return validateRuleInterpretationContextSetting(value);
    },
  },
  {
    name: REFERENCE_LINKS_SETTING,
    type: "paragraph",
    label: "Optional Reference Links JSON",
    defaultValue: "",
    scope: SettingScope.Installation,
    helpText:
      "Optional JSON array of explanatory links the bot may cite when directly relevant. Links do not create enforceable rules.",
    onValidate({ value }) {
      return validateReferenceLinksSetting(value);
    },
  },
]);

/**
 * Shared handler for content moderation that can be invoked by different triggers.
 */
async function handleModeration(context: any, id: string, type: ContributionType): Promise<ModerationOutcome> {
  const openaiApiKey = await readOpenAIApiKey(context);
  const autoEnforceThreshold = await readAutoEnforceConfidenceThreshold(context);
  const ruleInterpretationContext =
    await readRuleInterpretationContext(context);
  const referenceLinks = await readReferenceLinks(context);
  return await moderateContribution(
    context.reddit,
    openaiApiKey,
    id,
    type,
    autoEnforceThreshold,
    undefined,
    ruleInterpretationContext,
    referenceLinks
  );
}

function buildManualModerationToastMessage(outcome: ModerationOutcome): string {
  switch (outcome.status) {
    case "removed":
      return `Removed: ${outcome.removalReasonTitle}`;
    case "triaged":
      return `Sent to triage: ${outcome.removalReasonTitle}`;
    case "no-removal-reason":
      return "No removal reason applied.";
    case "failed":
      return "AI review failed.";
  }
}

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

    await handleModeration(context, post.id, "post");
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

    await handleModeration(context, comment.id, "comment");
  },
});

/**
 * Menu item registration for manually triggering moderation from the UI.
 */
const types : ContributionType[] = ["comment", "post"];
types.forEach(type => {
  Devvit.addMenuItem({
    label: "Stickler-bot",
    location: type,
    forUserType: "moderator", // Only show the menu item to moderators
    onPress: async (event : MenuItemOnPressEvent, context) => {
      const targetId : string | undefined = event.targetId;
      if (targetId == null) {
        const message = "MenuItemOnPressEvent is missing the targetId";
        console.error(message);
        context.ui.showToast(message);
        return;
      }

      await handleModeration(context, targetId, type).then((outcome) => {
        context.ui.showToast(buildManualModerationToastMessage(outcome));
      }).catch((error) => {
        console.error(error);
        context.ui.showToast("An error occurred during AI review.");
      });
    },
  });
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

/**
 * Reads optional JSON context used to interpret configured removal reasons.
 */
async function readRuleInterpretationContext(context: {
  settings: { get(name: string): Promise<unknown> };
}): Promise<RuleInterpretationContext | undefined> {
  const rawValue = await context.settings.get(
    RULE_INTERPRETATION_CONTEXT_SETTING
  );
  const result = parseRuleInterpretationContext(rawValue);

  if (!result.ok) {
    console.warn(
      `Ignoring invalid Rule Interpretation Context setting: ${result.error}`
    );
    return undefined;
  }

  return result.context;
}

/**
 * Reads optional configured links the model can select for public replies.
 */
async function readReferenceLinks(context: {
  settings: { get(name: string): Promise<unknown> };
}): Promise<ReferenceLink[]> {
  const rawValue = await context.settings.get(REFERENCE_LINKS_SETTING);
  const result = parseReferenceLinks(rawValue);

  if (!result.ok) {
    console.warn(`Ignoring invalid Reference Links setting: ${result.error}`);
    return [];
  }

  return result.referenceLinks;
}

export default Devvit;
