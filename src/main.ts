/**
 * Application entrypoint module.
 *
 * This module wires Devvit configuration, installation settings, and trigger
 * registration, then delegates moderation behavior to the moderation service.
 */
import { Devvit, SettingScope } from "@devvit/public-api";

import { OPENAI_API_KEY_SETTING } from "./constants.js";
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
    await moderateContribution(context.reddit, openaiApiKey, post.id, "post");
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
    await moderateContribution(context.reddit, openaiApiKey, comment.id, "comment");
  },
});

/**
 * Reads the configured OpenAI API key from installation settings.
 */
async function readOpenAIApiKey(context: { settings: { get(name: string): Promise<unknown> } }): Promise<string> {
  const rawValue = await context.settings.get(OPENAI_API_KEY_SETTING);
  return typeof rawValue === "string" ? rawValue : "";
}

export default Devvit;
