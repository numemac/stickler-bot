import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReferenceLinks,
  validateReferenceLinksSetting,
} from "../src/referenceLinks.js";

test("parseReferenceLinks treats empty values as disabled", () => {
  assert.deepEqual(parseReferenceLinks(undefined), {
    ok: true,
    referenceLinks: [],
  });
  assert.deepEqual(parseReferenceLinks("   "), {
    ok: true,
    referenceLinks: [],
  });
});

test("parseReferenceLinks accepts configured https references", () => {
  const result = parseReferenceLinks(
    JSON.stringify([
      {
        label: "No One Is Infrastructure",
        url: "https://nume.ca/blog/no-one-is-infrastructure#section",
        use_when: "Use when availability or instrumentalization directly clarifies the removal explanation.",
      },
    ])
  );

  assert.deepEqual(result, {
    ok: true,
    referenceLinks: [
      {
        label: "No One Is Infrastructure",
        url: "https://nume.ca/blog/no-one-is-infrastructure",
        useWhen:
          "Use when availability or instrumentalization directly clarifies the removal explanation.",
      },
    ],
  });
});

test("validateReferenceLinksSetting rejects non-array JSON", () => {
  assert.equal(
    validateReferenceLinksSetting('{"label":"Not an array"}'),
    "Reference Links must be a valid JSON array of objects."
  );
});

test("validateReferenceLinksSetting rejects non-https URLs", () => {
  assert.equal(
    validateReferenceLinksSetting(
      JSON.stringify([
        {
          label: "Unsafe",
          url: "http://example.com",
          use_when: "Do not accept this.",
        },
      ])
    ),
    "Each Reference Link must have a valid https:// URL of 500 characters or less."
  );
});
