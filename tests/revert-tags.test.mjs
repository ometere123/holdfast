/**
 * Reading the tag out of a refusal message, against the strings the contract really produced.
 *
 * EVERY MESSAGE BELOW WAS OBSERVED, NOT COMPOSED. Each one came out of `tests/direct/test_retrieval.py`
 * running the assembled contract under the real GenVM SDK, and they are pasted here rather than
 * paraphrased because the whole point of this module is the exact shape. A message written to suit the
 * parser would test nothing: the defect this file exists to prevent was a parser written to suit a
 * message shape that half the refusals do not use.
 *
 * The two shapes, and why there are two. `_reject` and the hand-written raises put the tag at index
 * zero. A `Refusal` from the embedded archive region travels out through `gl.eq_principle.strict_eq`
 * as `refusal.message`, which is a property returning `repr(self)`, so `_raise_if_error` re-raises
 * `Refusal([TAG] reason: detail)` verbatim and the tag lands at index eight with a parenthesis on the
 * end. Both are correct and neither is going to change; a reader has to cope with both.
 *
 * The delivery is a third axis and it is deliberately not one of these cases. Both payable methods
 * refund and RETURN their refusal rather than raising it, and `_refund_and_report` passes the sentence
 * through verbatim, so the same two shapes arrive by return as well as by throw. What that costs this
 * file is nothing; what it costs `genlayer/returned-value.ts` is a test of its own, in
 * `tests/returned-value.test.mjs`, because there the question is not what shape the message is but
 * whether a FINALIZED transaction was an acceptance or a refund.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findRefusal, reasonAfterTag } from "../src/lib/revert-tags.ts";
import { OUTCOMES } from "../src/lib/lifecycle.ts";

const CONTRACT = readFileSync(new URL("../contracts/Holdfast.py", import.meta.url), "utf8");

/** Shape two: refusals from inside `strict_eq`, verbatim from the direct suite's output. */
const REPR_SHAPED = [
  {
    message:
      "Refusal([EXTERNAL] cdx-empty: 200 with a 3 byte body and zero change points; this is absence of data, never absence of change)",
    outcome: "external",
    reason:
      "cdx-empty: 200 with a 3 byte body and zero change points; this is absence of data, never absence of change",
  },
  {
    message:
      "Refusal([EXTERNAL] redirect: http 302, not followed; location='/web/20230320142124id_/https://cloud.google.com/terms/deprecation')",
    outcome: "external",
    reason:
      "redirect: http 302, not followed; location='/web/20230320142124id_/https://cloud.google.com/terms/deprecation'",
  },
  {
    message: "Refusal([EXTERNAL] cdx-length-cap: 260662 > 250000)",
    outcome: "external",
    reason: "cdx-length-cap: 260662 > 250000",
  },
  {
    message:
      "Refusal([EXTERNAL] cdx-length-unknown: index row carried no integer length, so the pre-filter cannot pass it)",
    outcome: "external",
    reason:
      "cdx-length-unknown: index row carried no integer length, so the pre-filter cannot pass it",
  },
  {
    message: "Refusal([EXPECTED] timestamp-not-14-digit: len=15)",
    outcome: "expected",
    reason: "timestamp-not-14-digit: len=15",
  },
  {
    message:
      "Refusal([TRANSIENT] digest-mismatch: want FO4FOH4ODHA2OQAWMSTZX2GKFRFINKYI got 4MTV3WACV5B5KT3BBAPQSD5CWZ5WNET2 over 215912 stored bytes)",
    outcome: "transient",
    reason:
      "digest-mismatch: want FO4FOH4ODHA2OQAWMSTZX2GKFRFINKYI got 4MTV3WACV5B5KT3BBAPQSD5CWZ5WNET2 over 215912 stored bytes",
  },
];

/* ------------------------------------------------------------------------- *
 * The shape that was being got wrong
 * ------------------------------------------------------------------------- */

test("the repr shape is classified by its tag, not by whether the tag is at the front", () => {
  for (const { message, outcome } of REPR_SHAPED) {
    const found = findRefusal(message);
    assert.ok(found, message);
    assert.equal(found.outcome, outcome, message);
    // The property that broke six tests in the direct suite before it was measured.
    assert.equal(message.startsWith(found.tag), false);
    assert.equal(message.indexOf(found.tag), "Refusal(".length);
  }
});

test("a digest mismatch is retryable, which is the defect that started this module", () => {
  const mismatch = REPR_SHAPED.find((row) => row.message.includes("digest-mismatch"));
  const found = findRefusal(mismatch.message);

  assert.equal(found.outcome, "transient");
  assert.equal(OUTCOMES[found.outcome].retry, true);

  // The old classifier matched lowercase English and had "digest mismatch across" on its transient
  // list, which the hyphenated reason does not contain, so this message matched nothing and fell
  // through to `expected`. Asserted as the near miss it was rather than described.
  const text = mismatch.message.toLowerCase();
  assert.equal(text.includes("digest mismatch across"), false);
  assert.equal(OUTCOMES.expected.retry, false);
});

test("the reason carries no stray parenthesis from the repr wrapper", () => {
  for (const { message, reason } of REPR_SHAPED) {
    const found = findRefusal(message);
    assert.equal(found.reason, reason);
    assert.equal(found.reason.endsWith(")"), false);
  }
});

/* ------------------------------------------------------------------------- *
 * The shape that was being got right
 * ------------------------------------------------------------------------- */

test("a tagged sentence keeps every character of its own punctuation", () => {
  // Verbatim from `check_commitment`, including the `row(s)` the old stripper would have had to be
  // careful about: it is balanced, so nothing is removed.
  const sentence =
    "[EXTERNAL] the index answered with 1 row(s) for https://cloud.google.com/terms and none is newer than the cursor at 20260129024608, so this call examined no document and reports nothing about the commitment";
  const found = findRefusal(sentence);

  assert.equal(found.outcome, "external");
  assert.equal(found.tag, "[EXTERNAL]");
  assert.equal(found.reason.startsWith("the index answered with 1 row(s)"), true);
  assert.equal(found.reason.endsWith("about the commitment"), true);
  assert.equal(found.reason.includes("row(s)"), true);
});

test("a sentence whose own parentheses are balanced is left alone", () => {
  const sentence =
    "[EXPECTED] the archive holds 2 change point(s) for https://example.com/terms at or after 20260129024608, under the 3 a bond needs.";
  assert.equal(reasonAfterTag(sentence, "[EXPECTED]").endsWith("a bond needs."), true);
  assert.equal(reasonAfterTag(sentence, "[EXPECTED]").includes("point(s)"), true);
});

/* ------------------------------------------------------------------------- *
 * The vocabulary, and the single-tag assumption behind first-match
 * ------------------------------------------------------------------------- */

test("every tag this module searches for is a tag the contract actually raises", () => {
  for (const [name, outcome] of Object.entries(OUTCOMES)) {
    // The contract declares these as aliases of the embedded region's literals, so the literal is
    // what to look for. A tag in the copy table that the contract never emits would be a class no
    // message can reach, which is worth failing over.
    assert.ok(CONTRACT.includes(`"${outcome.tag}"`), `${name} -> ${outcome.tag}`);
  }
});

test("no message carries two tags, which is what makes first match unambiguous", () => {
  const tags = Object.values(OUTCOMES).map((outcome) => outcome.tag);
  for (const { message } of REPR_SHAPED) {
    const present = tags.filter((tag) => message.includes(tag));
    assert.deepEqual(present.length, 1, message);
  }
  // And no tag is a substring of another, so a message containing one cannot appear to contain two.
  for (const outer of tags) {
    for (const inner of tags) {
      if (outer !== inner) {
        assert.equal(outer.includes(inner), false, `${outer} contains ${inner}`);
      }
    }
  }
});

/* ------------------------------------------------------------------------- *
 * Untagged messages
 * ------------------------------------------------------------------------- */

test("an untagged message is reported as untagged rather than given a default tag", () => {
  // Wallet and transport failures carry no tag at all, and handing them one would put words in the
  // contract's mouth. The callers decide what to do with null; this returns the fact.
  for (const message of [
    "User rejected the request.",
    "MetaMask - RPC Error: 4001",
    "fetch failed",
    "403 token quota is not enough",
    "",
  ]) {
    assert.equal(findRefusal(message), null, message);
  }
});

test("reasonAfterTag hands back everything it has when the tag it was given is absent", () => {
  // A caller that matched the wrong tag should show the reader the whole message, not an empty
  // string produced by slicing from index -1.
  assert.equal(reasonAfterTag("  fetch failed  ", "[EXTERNAL]"), "fetch failed");
});
