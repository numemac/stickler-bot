# stickler-bot

**Imagine if moderation started and ended with writing great rules.**

`stickler-bot` turns your subreddit **Removal Reasons** into an always-on first-pass mod assistant: it reviews content, enforces clear violations, and routes gray-area cases to humans.

Built by the **r/antinatalism** mod team to keep up with high-risk, fast-moving content, `stickler-bot` aims to make removals faster, more consistent, and easier to explain to users

## Why Moderators Install It

- **Reduces queue pressure:** handles obvious removals quickly.
- **Improves consistency:** uses your written removal reasons as the source of truth.
- **Keeps humans in control:** uncertain cases are routed to manual review.
- **Gives clear user feedback:** posts a rule-based removal explanation with a modmail link.

## How It Works (In Plain English)

1. A new post is submitted, or a comment gets reported.
2. The bot compares that content to your subreddit’s removal reasons.
3. It chooses the best single matching rule, or no violation.
4. It only auto-removes if confidence is high enough and no human review is needed.
5. If not, it opens an internal modmail triage thread so your team can decide.

For reported comments, it can include surrounding thread context so replies are judged in conversation, not isolation.

## What Your Community Sees

When the bot removes something, it posts a short moderator comment that includes:

- The violated rule
- A brief explanation
- A direct link to contact moderators

## Good Fit For

- High-volume communities
- Rule-heavy subreddits where consistency matters
- Mod teams that want faster first-pass enforcement without fully handing over judgment

## Writing Great Removal Reasons

The biggest performance lever is rule quality. In general, the best rules for `stickler-bot` combine strict safety boundaries with clear, written nuance.

What tends to work well:

- **Clear non-negotiables:** define which violations should always be removed.
- **“Not allowed” + “still allowed” in the same rule:** pair boundaries with allowed discussion to reduce over-removal.
- **Behavior over intent:** describe observable signals, not assumed motives.
- **Low-overlap categories:** make each rule distinct so one violation maps to one best reason.
- **User-ready removal text:** write reasons in language users can understand and act on.
- **Human backstop for ambiguity:** reserve edge cases for manual review instead of forcing weak auto-decisions.

Quick quality test before enabling automation:

1. Can two different mods read this rule and make the same call most of the time?
2. Does the rule clearly state both what is prohibited and what is allowed?
3. Could a user understand what to change next time from the removal message alone?
4. Would this rule still be clear without reading modmail history or internal context?
5. If this rule triggers, is it obvious why this rule is better than the other available reasons?

## Need to Know Before Install

### Setup

- Install through the Reddit Developers app platform.
- Configure these installation settings:
  - `openai-api-key`
  - `auto-enforce-confidence-threshold` (0 to 1, default `0.8`)

### Scope

- Reviews **new posts** automatically.
- Reviews **reported comments** (not every new comment).
- Can analyze Reddit-hosted images on posts when available.

### Human-Review Safety Gate

Auto-removal happens only when all are true:

- A removal reason is selected
- `needsHumanReview` is `false`
- Model confidence is at or above your threshold

Otherwise, the bot skips auto-enforcement and creates internal modmail triage.

### Privacy and Data Sent to OpenAI

To make decisions, the bot may send:

- Post/comment text
- For reported comments: parent-chain + post context
- Participant usernames in thread context are replaced with anonymized labels (for example, `User_1`, `User_2`) before sending context to OpenAI
- Subreddit removal reasons
- Image URLs for supported image posts

If your subreddit handles sensitive topics, review this with your mod team before rollout.

### Cost

OpenAI API usage is paid. Set usage limits in your OpenAI account before enabling broad automation.

### Limitations

- Decision quality depends on how clear your removal reasons are.
- False positives/negatives can still happen.
- AI moderation should be monitored and tuned over time.

## Recommended Rollout

1. Start in a lower-risk or test subreddit.
2. Watch removals and triage modmail closely.
3. Refine rule wording for cleaner matches.
4. Expand once behavior is stable.

## Links

- Devvit docs: https://developers.reddit.com/docs/
- Reddit developer portal: https://developers.reddit.com/my/apps
