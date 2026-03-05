# stickler-bot

An AI-assisted moderation helper for Reddit communities.

`stickler-bot` helps moderator teams enforce subreddit rules by reviewing content against your existing Reddit **Removal Reasons** and taking action when a likely violation is found.

Built by the **r/antinatalism** mod team to keep up with high-risk, fast-moving content, `stickler-bot` aims to make removals faster, more consistent, and easier to explain to users.

## What It Does

- Reviews new posts (`PostSubmit`)
- Reviews reported comments (`CommentReport`) only (not every new comment, to reduce API costs)
- For reported comments, includes parent-chain + post context so replies are judged in conversation
- Matches content to one removal reason (or none)
- Uses model confidence + human-review flag before auto-removal

When a violation is detected, it:

- Posts a short moderator reply explaining the removal
- Removes the item

If no violation is detected, it does nothing.

## Confidence and Human Review Gate

For each moderation decision, the model now returns:

- `confidence` (0 to 1)
- `needsHumanReview` (`true` or `false`)

The bot only auto-removes when all conditions are true:

- A removal reason is selected
- `needsHumanReview` is `false`
- `confidence` is greater than or equal to your configured threshold

If confidence is below threshold or `needsHumanReview` is `true`, the bot:

- Skips auto-enforcement
- Opens an internal Modmail triage thread with a link, suggested rule, confidence, and model justification

## What Users See on Removal

When an item is removed, the bot replies with:

- The violated rule title
- A short justification
- A direct modmail/contact link:
  `https://www.reddit.com/message/compose?to=r/{subreddit_name}`

## Image Posts

For posts with images, the bot can include vision analysis in the decision:

- Supports Reddit-hosted single-image and gallery posts
- Retries automatically if an image URL fails
- Falls back to text-only review if needed

## Comment Thread Context (for Mod Decisions)

When a reported comment is reviewed, the bot now builds a structured thread snapshot for the model:

- The **target comment** (the only item being moderated)
- Parent comments in order (parent, grandparent, great-grandparent, etc.)
- The top-of-thread **post context** (title + body, or URL if no body)
- An anonymized participant label (for example `User_1`, `User_2`) on each contribution

If the same Reddit account appears multiple times in the chain, it keeps the same anonymized label so the model can follow who said what without seeing raw usernames.

For very deep chains, the bot keeps the most useful context (root + latest ancestors) and may omit middle ancestors for prompt size.

## Before You Install

Please make sure:

- Your subreddit Removal Reasons are up-to-date and clearly written
- You have an OpenAI API key available
- Your mod team is comfortable with automated removals

## Data Sent to OpenAI

To make a decision, the bot may send:

- Post title/body or comment text
- For reported comments: target comment + parent-chain context + top-level post context
- Anonymized participant labels for context tracking (not raw commenter usernames/IDs in this metadata layer)
- Your Removal Reasons (titles and messages)
- For image posts, up to a few Reddit image URLs for vision analysis

Model output used for enforcement includes:

- `removalReasonIndex`
- `justification`
- `confidence`
- `needsHumanReview`

If you moderate sensitive topics, review this carefully before enabling automation.

## Costs and Budgeting

OpenAI API calls cost money. You should estimate expected volume (new posts + comment reports) and set a budget/usage limits in the OpenAI UI to prevent unexpected spend or abuse.

## Installation (Moderator View)

Install via the Reddit Developers App platform, then set the installation setting:

- `openai-api-key` (secret string)
- `auto-enforce-confidence-threshold` (number from 0 to 1, default `0.8`)

Without this setting, the bot cannot classify content.

## Safety and Abuse Resistance

The bot includes protections against prompt-injection and text abuse:

- Treats post/comment text as untrusted input data
- Instructs the model to ignore embedded instructions in user content
- Validates model output format before acting
- Sanitizes model-generated text before posting user-visible replies
- Skips bot-authored, already removed, and distinguished items
- Uses these actions only: reply + remove for auto-enforced violations, and internal Modmail triage for skipped enforcement cases

## Current Scope and Limitations

- Comment auto-moderation currently runs on **reported comments** (not every new comment)
- Decision quality depends heavily on rule quality and clarity
- As with any AI moderation system, false positives/negatives can occur

## Recommended Rollout

1. Install in a lower-risk/test subreddit first
2. Monitor logs and removals closely
3. Refine Removal Reasons for clearer rule matching
4. Expand use once behavior matches moderator expectations

## Support and Docs

- Devvit docs: https://developers.reddit.com/docs/
- Developer portal: https://developers.reddit.com/my/apps
