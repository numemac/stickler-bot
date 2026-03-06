# stickler-bot

**AI-assisted Reddit moderation that turns written rules into consistent enforcement.**

`stickler-bot` is built for the way moderation actually works on Reddit: each subreddit defines local standards, moderators enforce those standards under pressure, and consistency is hard to maintain at scale. The bot does not replace moderator judgment. It applies your existing **Removal Reasons** as a first-pass classifier, auto-enforces only when confidence is strong, and escalates ambiguous cases to human review.

## Why It Exists

- **Reddit governance is local:** communities need tools that follow subreddit-specific rules, not a generic policy engine.
- **Speed changes culture:** delayed enforcement can normalize behavior your team does not actually permit.
- **Moderator energy is finite:** repetitive decisions should be automated where rules are clear and confidence is high.

## How It Works

1. A new post is submitted, or a comment gets reported.
2. The bot builds context and compares the contribution to your subreddit Removal Reasons.
3. The model returns a structured decision: matched rule or no violation, plus justification, confidence, and a human-review flag.
4. If confidence passes your threshold and human review is not requested, the bot posts a rule-linked removal reply and removes the item.
5. If confidence is low or risk is ambiguous, the bot skips auto-enforcement and opens internal modmail triage.

## Enforcement Safety Gate

Auto-removal happens only when all conditions are true:

- A removal reason is selected
- `needsHumanReview` is `false`
- Confidence is at or above `auto-enforce-confidence-threshold` (default `0.8`)

This keeps the bot procedural and conservative instead of overconfident.

## Alpha Pilot Communities

`r/antinatalism` and `r/VeganDating` are the first subreddits alpha testing stickler-bot. They are intentionally distinct communities, which makes them useful pilots for validating portability across different moderation pressures while staying grounded in each subreddit's own written rules.

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
- Skips Reddit-hosted video uploads unless the post includes substantial body text (200+ characters).

### Privacy and Data Sent to OpenAI

To make decisions, the bot may send:

- Post/comment text
- For reported comments: parent-chain + post context
- Participant usernames in thread context are replaced with anonymized labels (for example, `User_1`, `User_2`) before sending context to OpenAI
- Subreddit removal reasons
- Image URLs for supported image posts

### Cost

OpenAI API usage is paid. Set usage limits in your OpenAI account before enabling broad automation.

### Current Limits

- Decision quality depends on how clear your removal reasons are.
- False positives/negatives can still happen.
- This tool supports moderator judgment; it does not replace it.

## Writing Strong Removal Reasons

The biggest performance lever is rule quality. What consistently works:

- Define clear non-negotiables.
- Pair prohibited behavior with allowed behavior in the same rule.
- Use observable criteria, not intent guessing.
- Keep rule categories distinct so one violation maps to one best reason.
- Write user-ready removal text.
- Reserve ambiguous edge cases for human review.

## Recommended Rollout

1. Start in a lower-risk or test subreddit.
2. Watch removals and triage modmail closely.
3. Refine rule wording for cleaner matches.
4. Expand once behavior is stable.

## Developer Commands (Repo)

```bash
npm run type-check
npm run test:unit
npm run dev
npm run deploy
```

## Links

- Concept paper: https://stickler-bot.org
- Devvit docs: https://developers.reddit.com/docs/
- Reddit developer portal: https://developers.reddit.com/my/apps
