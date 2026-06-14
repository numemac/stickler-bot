import assert from "node:assert/strict";
import test from "node:test";

import { buildRemovalReply } from "../src/moderation/removalReply.js";

test("buildRemovalReply centers the public justification without repeating the full rule message", () => {
  const reply = buildRemovalReply(
    "post",
    "exampleSub",
    {
      id: "r1",
      title: "No harassment",
      message: "This long removal reason should stay in the rules page, not the reply.",
    },
    "This targets people rather than engaging the idea. You can repost with a focus on the argument instead."
  );

  assert.match(reply, /Your post has been removed\./);
  assert.match(reply, /\*\*Rule applied:\*\* No harassment/);
  assert.match(reply, /\*\*Why this was removed:\*\*\nThis targets people rather than engaging the idea\./);
  assert.doesNotMatch(reply, /This long removal reason should stay in the rules page/);
});

test("buildRemovalReply appends configured reference link markdown", () => {
  const reply = buildRemovalReply(
    "comment",
    "exampleSub",
    {
      id: "r1",
      title: "No instrumentalization",
      message: "Full rule text omitted.",
    },
    "This frames people as material for someone else's project. [Do not keep model links](https://bad.example).",
    {
      label: "No One Is Infrastructure",
      url: "https://nume.ca/blog/no-one-is-infrastructure",
      useWhen: "Availability or instrumentalization directly clarifies the explanation.",
    }
  );

  assert.match(
    reply,
    /Related: \[No One Is Infrastructure\]\(https:\/\/nume\.ca\/blog\/no-one-is-infrastructure\)/
  );
  assert.doesNotMatch(reply, /bad\.example/);
});
