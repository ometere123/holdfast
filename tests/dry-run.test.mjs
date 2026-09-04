/**
 * The zero-value simulation, and the one classification mistake that would cost a stake.
 *
 * The contract's value check is deliberately the last deterministic check (`Holdfast.py:2605`), so
 * reaching it means nothing above it objected. That is the whole reason a call with no value is a
 * usable simulation of a call with value.
 *
 * `create_bond` no longer reverts on a refusal. It is a refusal boundary that refunds and RETURNS the
 * tagged sentence (`Holdfast.py:2506`), which moved the pass signal from the thrown message to the
 * returned one. An earlier version of this file asserted that any normal return was INCONCLUSIVE.
 * That was correct against a reverting contract and would have graded every clean draft unanswerable
 * against this one, because a clean draft with no stake is now precisely the case that returns. The
 * test that used to read "a normal return is never PASSED" now reads "an UNTAGGED return is never
 * PASSED", which is the rule that was load bearing all along.
 *
 * Every branch below exists to keep one rule true: a simulation that did not run must never be drawn
 * as a simulation that passed.
 *
 * `classifyDryRun` is pure, so all six branches are reachable here with no node and no wallet.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAKE_REFUSAL, classifyDryRun, dryRunCreateBond } from "../src/lib/dry-run.ts";
import { CONTRACT_ADDRESS, IS_LIVE } from "../src/lib/genlayer/config.ts";

/* ------------------------------------------------------------------------- *
 * The branch that matters most
 * ------------------------------------------------------------------------- */

test("an untagged return is INCONCLUSIVE and never PASSED, because no tag means nothing answered", () => {
  // `create_bond` refuses by returning a tagged sentence, so a return carrying no tag is not a
  // refusal this contract produced. Under zero value the value check has to fire, so an untagged
  // return means the deterministic body did not run and the simulation answered nothing. Reading it
  // as a pass is the one mistake in this file that would put a draft in front of a wallet on no
  // evidence at all.
  const returned = classifyDryRun({ returned: "anything at all" });
  assert.equal(returned.kind, "INCONCLUSIVE");
  assert.match(returned.detail, /answered nothing/);

  // The branch is on there being no tagged refusal, not on the value being falsy or absent, so an
  // untagged string and a non-string take it alike.
  assert.equal(classifyDryRun({ returned: "" }).kind, "INCONCLUSIVE");
  assert.equal(classifyDryRun({ returned: 0 }).kind, "INCONCLUSIVE");
  assert.equal(classifyDryRun({ returned: null }).kind, "INCONCLUSIVE");
  assert.equal(classifyDryRun({}).kind, "INCONCLUSIVE");

  // A tagged sentence buried in a non-string is deliberately not dug out of it. `readContract`
  // decodes a `-> str` method to a string, so any other shape is one this module has not measured,
  // and inventing a reader for it is how an unmeasured shape becomes a silent pass.
  const boxed = classifyDryRun({ returned: { readable: `[EXPECTED] ${STAKE_REFUSAL}` } });
  assert.equal(boxed.kind, "INCONCLUSIVE");
});

test("the refund boundary's returned refusal is the pass, because returning is how it now refuses", () => {
  // THE REGRESSION THIS TEST EXISTS FOR. `create_bond` catches its own refusal and returns the
  // tagged sentence instead of raising it, so a clean draft simulated with no stake does not throw
  // at all. Until that was handled the clean draft took the untagged-return branch above and came
  // back as unanswerable, which is the reading that pushes a caller to sign anyway.
  const returned = classifyDryRun({ returned: `[EXPECTED] ${STAKE_REFUSAL}` });
  assert.equal(returned.kind, "PASSED");

  // And the delivery must not change the verdict, which is the property the contract's own docstring
  // claims when it says only the delivery changed.
  const thrown = classifyDryRun({ thrown: `[EXPECTED] ${STAKE_REFUSAL}` });
  assert.deepEqual(returned, thrown);
});

test("a returned refusal is read in the wrapped shape too, where the tag is not at the front", () => {
  // A refusal raised inside a consensus block and caught at the boundary arrives as
  // `Refusal([TAG] reason)`, tag at index 8, so a leading-tag test would miss it. Returned, not
  // thrown, and the trailing parenthesis of the repr is not part of the reason.
  const wrapped = classifyDryRun({ returned: "Refusal([EXPECTED] bond id already exists)" });
  assert.equal(wrapped.kind, "REFUSED");
  assert.equal(wrapped.reason, "bond id already exists");

  const other = classifyDryRun({ returned: "Refusal([EXTERNAL] cdx-empty: 200 with a 3 byte body)" });
  assert.equal(other.kind, "INCONCLUSIVE");
  assert.match(other.detail, /\[EXTERNAL\]/);
  assert.match(other.detail, /not a judgement about this draft/);
});

/* ------------------------------------------------------------------------- *
 * The pass
 * ------------------------------------------------------------------------- */

test("stopping at the value check is the pass, and the pass says what it does not cover", () => {
  const result = classifyDryRun({ thrown: `[EXPECTED] ${STAKE_REFUSAL}` });
  assert.equal(result.kind, "PASSED");
  assert.match(result.caveat, /last thing it checks before it touches the network/);
  // The caveat has to name the two archive questions, because a bare "passed" would read as a
  // promise that the write will succeed, and the archive checks have not run.
  assert.match(result.caveat, /enough captures/);
  assert.match(result.caveat, /baseline capture qualifies/);
});

test("the stake refusal is matched inside a longer message, not compared against the whole of it", () => {
  // The real message arrives tagged and may be wrapped by the transport, so the check is a
  // substring test and every one of these has to reach PASSED.
  const shapes = [
    STAKE_REFUSAL,
    `[EXPECTED] ${STAKE_REFUSAL}`,
    `UserError(message='[EXPECTED] ${STAKE_REFUSAL}')`,
    `execution failed: rollback: [EXPECTED] ${STAKE_REFUSAL}\n  at create_bond`,
  ];
  for (const shape of shapes) assert.equal(classifyDryRun({ thrown: shape }).kind, "PASSED", shape);
});

test("the stake refusal is tested before the [EXPECTED] branch, which would otherwise swallow it", () => {
  // The refusal arrives carrying [EXPECTED], so both branches match the same string. Order is what
  // makes one of them the pass. If this ever flipped, a perfect draft would be reported as refused
  // for needing a stake, which is exactly the thing the caller deliberately withheld.
  const both = `[EXPECTED] ${STAKE_REFUSAL}`;
  assert.ok(both.includes("[EXPECTED]"));
  assert.equal(classifyDryRun({ thrown: both }).kind, "PASSED");
});

/* ------------------------------------------------------------------------- *
 * The refusal
 * ------------------------------------------------------------------------- */

test("an [EXPECTED] refusal is a verdict about the draft, with the tag stripped", () => {
  const result = classifyDryRun({ thrown: "[EXPECTED] bond id already exists" });
  assert.equal(result.kind, "REFUSED");
  assert.equal(result.reason, "bond id already exists");
});

test("the stripped reason keeps everything after the tag and drops the surrounding whitespace", () => {
  const result = classifyDryRun({ thrown: "  [EXPECTED]   url and commitment already bonded  " });
  assert.equal(result.kind, "REFUSED");
  assert.equal(result.reason, "url and commitment already bonded");
});

test("the two refusals the dry run exists for are both reachable, and they are contract state", () => {
  // Neither of these can be answered from a browser, which is why `UNCHECKABLE_BEFORE_SIGNING`
  // lists them and why the simulation is not decoration.
  for (const reason of ["bond id already exists", "url and commitment pair already bonded"]) {
    const result = classifyDryRun({ thrown: `[EXPECTED] ${reason}` });
    assert.equal(result.kind, "REFUSED");
    assert.equal(result.reason, reason);
  }
});

/* ------------------------------------------------------------------------- *
 * The three tags that are not verdicts
 * ------------------------------------------------------------------------- */

test("the other three tags are inconclusive, and each says which tag it was", () => {
  for (const tag of ["[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"]) {
    const result = classifyDryRun({ thrown: `${tag} the archive returned 429` });
    assert.equal(result.kind, "INCONCLUSIVE", tag);
    assert.match(result.detail, new RegExp(tag.replace(/[[\]]/g, "\\$&")));
    assert.match(result.detail, /not a judgement about this draft/);
    assert.match(result.detail, /the archive returned 429/);
  }
});

test("a tagged message beats the transport guess, in both directions", () => {
  // Both of these also match `looksUnsupported`. The tag is the contract speaking and wins, because
  // reporting a real refusal as "this node would not simulate" hides a verdict the caller needs.
  const transient = classifyDryRun({ thrown: "[TRANSIENT] the read-only replica timed out" });
  assert.equal(transient.kind, "INCONCLUSIVE");
  assert.match(transient.detail, /\[TRANSIENT\]/);

  const expected = classifyDryRun({ thrown: "[EXPECTED] create_bond is not a view of anything" });
  assert.equal(expected.kind, "REFUSED");
  assert.equal(expected.reason, "create_bond is not a view of anything");
});

/* ------------------------------------------------------------------------- *
 * The node declining to simulate
 * ------------------------------------------------------------------------- */

test("every phrasing of a node declining to run a write as a read is UNSUPPORTED", () => {
  const phrasings = [
    "create_bond is not a view",
    "non-view method rejected",
    "endpoint is read-only",
    "readonly call refused",
    "unsupported method for eth_call",
    "method not supported on this node",
    "this node does not support simulating writes",
    "create_bond is not callable as a read",
    "cannot simulate a write method",
    "the method opens a nondeterministic block",
    "method not found",
  ];
  for (const phrasing of phrasings) {
    const result = classifyDryRun({ thrown: phrasing });
    assert.equal(result.kind, "UNSUPPORTED", phrasing);
    // The detail quotes the node so the reader can see the refusal was the transport's, not a
    // judgement about the draft, and says plainly that only the local checks ran.
    assert.match(result.detail, /only the local checks above ran/);
    assert.ok(result.detail.includes(phrasing), phrasing);
  }
});

test("the transport guess is case insensitive, because node error text is not stable in case", () => {
  assert.equal(classifyDryRun({ thrown: "Method Not Found" }).kind, "UNSUPPORTED");
  assert.equal(classifyDryRun({ thrown: "NOT A VIEW" }).kind, "UNSUPPORTED");
});

/* ------------------------------------------------------------------------- *
 * The fallthrough
 * ------------------------------------------------------------------------- */

test("anything else is inconclusive and quotes itself rather than being interpreted", () => {
  const result = classifyDryRun({ thrown: "fetch failed" });
  assert.equal(result.kind, "INCONCLUSIVE");
  assert.match(result.detail, /nothing can be concluded from it either way/);
  assert.match(result.detail, /fetch failed/);
});

test("every outcome carries a non-empty sentence on the field its kind uses", () => {
  const outcomes = [
    classifyDryRun({ returned: 1 }),
    classifyDryRun({ thrown: `[EXPECTED] ${STAKE_REFUSAL}` }),
    classifyDryRun({ thrown: "[EXPECTED] bond id already exists" }),
    classifyDryRun({ thrown: "[EXTERNAL] throttled" }),
    classifyDryRun({ thrown: "not a view" }),
    classifyDryRun({ thrown: "socket hang up" }),
  ];
  const kinds = new Set(outcomes.map((outcome) => outcome.kind));
  assert.deepEqual([...kinds].sort(), ["INCONCLUSIVE", "PASSED", "REFUSED", "UNSUPPORTED"]);
  for (const outcome of outcomes) {
    const sentence =
      outcome.kind === "PASSED"
        ? outcome.caveat
        : outcome.kind === "REFUSED"
          ? outcome.reason
          : outcome.detail;
    assert.ok(sentence.length > 0, outcome.kind);
  }
});

/* ------------------------------------------------------------------------- *
 * The parity that makes the pass mean anything
 * ------------------------------------------------------------------------- */

test("the refusal this module matches on exists verbatim in the deployed contract source", () => {
  // This is the load bearing assertion of the file. `STAKE_REFUSAL` is a copy of a string in
  // `Holdfast.py`, and a substring match against a string the contract no longer raises would
  // silently turn every clean draft into INCONCLUSIVE, which reads as "we could not tell" and
  // pushes the caller to send the stake anyway.
  const source = readFileSync(new URL("../contracts/Holdfast.py", import.meta.url), "utf8");
  assert.ok(source.includes(STAKE_REFUSAL), "Holdfast.py no longer raises the string dry-run.ts matches");
  // And it is raised through `_reject`, so it arrives tagged [EXPECTED], which is what makes the
  // ordering test above load bearing rather than hypothetical.
  assert.ok(source.includes(`self._reject("${STAKE_REFUSAL}")`));
});

/* ------------------------------------------------------------------------- *
 * The call wrapper
 * ------------------------------------------------------------------------- */

test("with no contract configured the dry run is SKIPPED, and says the local checks still ran", async () => {
  if (IS_LIVE && CONTRACT_ADDRESS) {
    // A configured build would reach the network here, which a unit test must not do. The
    // conditional is the honest form: this assertion is about the unconfigured build.
    assert.ok(true);
    return;
  }
  const result = await dryRunCreateBond([]);
  assert.equal(result.kind, "SKIPPED");
  assert.match(result.detail, /nothing to simulate against/);
  assert.match(result.detail, /local checks above ran for real/);
});

test("a client that throws is classified rather than allowed to escape", async () => {
  if (!IS_LIVE || !CONTRACT_ADDRESS) {
    // The SKIPPED guard fires before the client is ever consulted, so this path is only reachable
    // in a configured build. Asserting the guard is what is available here.
    assert.equal((await dryRunCreateBond([], { readContract: async () => "x" })).kind, "SKIPPED");
    return;
  }
  const thrower = {
    readContract: async () => {
      throw new Error(`[EXPECTED] ${STAKE_REFUSAL}`);
    },
  };
  assert.equal((await dryRunCreateBond([], thrower)).kind, "PASSED");
});
