/**
 * The two descriptions of one write, and the four ways a write can end.
 *
 * `lifecycle.ts` is almost entirely prose, so most of what can go wrong with it is a claim that is no
 * longer true of the contract. Seven such claims were wrong in an earlier version, and one of them
 * was a whole program of work for `renew_bond`, a method that does not exist: a table describing six
 * confident steps, printed before a call that fails at the node after the wallet has already opened.
 * So the tests below check the module against the contract rather than against itself, twice by
 * reading `Holdfast.py`.
 *
 * The rule that gives the file its shape: a network step and an inference step are different kinds of
 * claim. One is bytes every validator agreed on, the other is a reading of them. Every step declares
 * which it is, and no step may be drawn without a named source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLANK_FRAME_MEANING,
  CHECK_PROGRAM,
  CLIENT_PHASES,
  CREATE_PROGRAM,
  OUTCOMES,
  PROGRAMS,
  STEP_KIND_TEXT,
  heldHeadline,
  programFor,
} from "../src/lib/lifecycle.ts";
import { REQUIRED_METHODS } from "../src/lib/genlayer/config.ts";

const SOURCE = readFileSync(new URL("../contracts/Holdfast.py", import.meta.url), "utf8");

/* ------------------------------------------------------------------------- *
 * The client's own phases
 * ------------------------------------------------------------------------- */

test("the client phases are the write phases minus idle, because idle is the absence of a run", () => {
  assert.deepEqual(CLIENT_PHASES.map((phase) => phase.key), [
    "validating",
    "wallet-pending",
    "submitted",
    "consensus-running",
    "settled",
  ]);
  assert.ok(!CLIENT_PHASES.some((phase) => phase.key === "idle"));
});

test("exactly two phases cost a signature, and they are the two either side of the wallet", () => {
  const signing = CLIENT_PHASES.filter((phase) => phase.costsSignature).map((phase) => phase.key);
  assert.deepEqual(signing, ["wallet-pending", "submitted"]);
  // Consensus does not cost a second signature, which is the thing a reader watching a four minute
  // run most needs to be told.
  assert.equal(CLIENT_PHASES.find((phase) => phase.key === "consensus-running")?.costsSignature, false);
});

test("every phase carries a label and a detail, so no step in the strip is unexplained", () => {
  for (const phase of CLIENT_PHASES) {
    assert.ok(phase.label.length > 0, phase.key);
    assert.ok(phase.detail.length > 20, phase.key);
  }
});

/* ------------------------------------------------------------------------- *
 * Programs of work, checked against the contract's real method list
 * ------------------------------------------------------------------------- */

test("a program exists for exactly the six write methods, and renew_bond is not among them", () => {
  assert.deepEqual(Object.keys(PROGRAMS).sort(), [
    "adjudicate_contest",
    "check_commitment",
    "contest_breach",
    "create_bond",
    "expire_bond",
    "settle_breach",
  ]);
  assert.equal(PROGRAMS.renew_bond, undefined);
});

test("every method with a program is a method the contract actually defines", () => {
  // The check the earlier version failed. Both halves matter: the deployment verifier's list, and
  // the contract source itself, since the list is also hand written.
  for (const method of Object.keys(PROGRAMS)) {
    assert.ok(REQUIRED_METHODS.includes(method), `${method} is not in REQUIRED_METHODS`);
    assert.ok(SOURCE.includes(`def ${method}(`), `${method} is not defined in Holdfast.py`);
  }
  assert.ok(!SOURCE.includes("def renew_bond("));
});

test("an unknown method gets no program at all, rather than somebody else's", () => {
  // The previous default returned the settlement steps for anything unrecognised, so a typo printed
  // a confident description of a transfer that was not about to happen.
  assert.equal(programFor("renew_bond"), undefined);
  assert.equal(programFor("settle_bond"), undefined);
  assert.equal(programFor(""), undefined);
  assert.equal(programFor("check_commitment"), CHECK_PROGRAM);
});

test("every step names a source and declares one of the three kinds", () => {
  const kinds = new Set(Object.keys(STEP_KIND_TEXT));
  assert.deepEqual([...kinds].sort(), ["deterministic", "inference", "network"]);
  for (const [method, steps] of Object.entries(PROGRAMS)) {
    assert.ok(steps.length > 0, method);
    for (const step of steps) {
      assert.ok(kinds.has(step.kind), `${method}/${step.key}: ${step.kind}`);
      // A row with no named source is a row that should not be drawn: it would read as a spinner
      // with a caption, which is the thing this table exists instead of.
      assert.ok(step.source.length > 0, `${method}/${step.key}`);
      assert.ok(step.label.length > 0, `${method}/${step.key}`);
      assert.ok(step.detail.length > 20, `${method}/${step.key}`);
    }
    // Step keys are unique inside a program, because the table is keyed on them.
    const keys = steps.map((step) => step.key);
    assert.equal(new Set(keys).size, keys.length, method);
  }
});

test("each of the three kinds says what sort of claim it is, in the same terms every time", () => {
  assert.match(STEP_KIND_TEXT.deterministic, /bytes the contract already holds/);
  assert.match(STEP_KIND_TEXT.network, /agreed byte for byte across validators/);
  assert.match(STEP_KIND_TEXT.inference, /bounded and quoted from the document/);
});

test("at most one step per program is a reading, and the two that pay out have none", () => {
  for (const [method, steps] of Object.entries(PROGRAMS)) {
    const readings = steps.filter((step) => step.kind === "inference");
    assert.ok(readings.length <= 1, `${method} has ${readings.length} readings`);
  }
  // Settlement and expiry move money and ask the model nothing. Both re-verify bytes instead, which
  // is the reason a capture withdrawn from the archive cannot become a payout.
  for (const method of ["settle_breach", "expire_bond"]) {
    assert.equal(PROGRAMS[method].filter((step) => step.kind === "inference").length, 0, method);
  }
});

test("filing a contest touches no network, and adjudicating it does", () => {
  // This is the split that makes the contest honest: filing is a citation plus a bond and decides
  // nothing, and the reading happens in a separate call anybody may make.
  assert.deepEqual(new Set(PROGRAMS.contest_breach.map((step) => step.kind)), new Set(["deterministic"]));
  const adjudication = PROGRAMS.adjudicate_contest.map((step) => step.kind);
  assert.ok(adjudication.includes("network"));
  assert.ok(adjudication.includes("inference"));
});

test("the check reads the index before the snapshot, and decodes before it gates", () => {
  // Order is the specification here. Gating undecoded bytes is the project's central failure: a gzip
  // replay is byte-identical for every validator, so a gate applied to it agrees unanimously on
  // binary noise.
  const order = CHECK_PROGRAM.map((step) => step.key);
  assert.ok(order.indexOf("cdx") < order.indexOf("replay"), "the index is read before the snapshot");
  assert.ok(order.indexOf("digest") < order.indexOf("decode"), "the digest is checked before decoding");
  assert.ok(order.indexOf("decode") < order.indexOf("gates"), "bytes are decoded before they are gated");
  assert.ok(order.indexOf("gates") < order.indexOf("reading"), "only an admitted document is read");
  assert.ok(order.indexOf("reading") < order.indexOf("record"), "the reading is recorded last");
});

test("creation escrows the stake after it has verified a baseline, not before", () => {
  const order = CREATE_PROGRAM.map((step) => step.key);
  assert.equal(order[0], "validate");
  assert.equal(order[order.length - 1], "escrow");
  assert.ok(order.indexOf("verify") < order.indexOf("escrow"));
});

/* ------------------------------------------------------------------------- *
 * Outcomes, against the contract's own four tags
 * ------------------------------------------------------------------------- */

test("the four outcome tags are the four tags the contract declares, verbatim", () => {
  const tags = Object.values(OUTCOMES).map((outcome) => outcome.tag).sort();
  assert.deepEqual(tags, ["[EXPECTED]", "[EXTERNAL]", "[LLM_ERROR]", "[TRANSIENT]"]);
  // Read out of the contract rather than restated, because a decoder that matches a tag the contract
  // no longer raises reports every failure as the fallthrough.
  for (const tag of tags) {
    assert.ok(SOURCE.includes(`= "${tag}"`), `Holdfast.py does not declare ${tag}`);
  }
});

test("a finding has no outcome entry, because a finding is a result and not an error", () => {
  // `OutcomeClass` includes "finding" and `OUTCOMES` deliberately excludes it. A weakened commitment
  // is what the contract is for; describing it in the same table as a throttled archive would put a
  // retry button under it.
  assert.equal(OUTCOMES.finding, undefined);
  assert.deepEqual(Object.keys(OUTCOMES).sort(), ["expected", "external", "llm-error", "transient"]);
});

test("only a refusal is final, and every other outcome invites the call to be made again", () => {
  assert.equal(OUTCOMES.expected.retry, false);
  for (const key of ["external", "transient", "llm-error"]) {
    assert.equal(OUTCOMES[key].retry, true, key);
  }
});

test("every outcome says what happened to the strip and to the light table", () => {
  for (const [key, outcome] of Object.entries(OUTCOMES)) {
    assert.ok(outcome.headline.length > 0, key);
    assert.ok(outcome.body.length > 40, key);
    // Both of these are part of the outcome rather than decided at the render site, so a state that
    // requires an unchanged strip cannot drift into drawing a new frame.
    assert.ok(outcome.strip.length > 0, key);
    assert.ok(outcome.lightTable.length > 0, key);
  }
});

test("a refusal says plainly that nothing moved, and the archive was never touched", () => {
  assert.match(OUTCOMES.expected.body, /no stake moved/);
  assert.match(OUTCOMES.expected.body, /no archive was touched/);
  assert.match(OUTCOMES.expected.body, /input is unchanged/);
});

test("an unreachable archive is neither a kept promise nor a broken one, and says so", () => {
  // The sentence that keeps the product honest under the failure it will hit most often.
  assert.match(OUTCOMES.external.body, /never an intact commitment and never a broken one/);
  assert.match(OUTCOMES.transient.body, /did not read the same capture/);
  assert.match(OUTCOMES["llm-error"].body, /cannot be quoted from the document is not a finding/);
});

/* ------------------------------------------------------------------------- *
 * The blank frame, which belongs to no error class
 * ------------------------------------------------------------------------- */

test("the blank frame's meaning is stated once, and is not one of the error outcomes", () => {
  // A blank frame is the only failure this contract writes down. Every other failure reverts and
  // records nothing, which is why the strip stops for those and has a frame for this one.
  assert.match(BLANK_FRAME_MEANING, /arrived and verified, then failed a gate/);
  assert.match(BLANK_FRAME_MEANING, /never counted as the commitment weakening/);
  for (const outcome of Object.values(OUTCOMES)) {
    assert.notEqual(outcome.body, BLANK_FRAME_MEANING);
  }
});

/* ------------------------------------------------------------------------- *
 * The success wording
 * ------------------------------------------------------------------------- */

test("the success headline agrees in number and never claims more than the archive shows", () => {
  const one = heldHeadline("1", 1);
  assert.equal(one.headline, "The commitment was unchanged across 1 archived capture.");
  const many = heldHeadline("13", 41);
  assert.equal(many.headline, "The commitment was unchanged across 41 archived captures.");
  // The limit travels with the headline rather than sitting in a footnote, because "unchanged" reads
  // as "kept" to anybody who is not looking for the difference.
  assert.match(many.limit, /does not mean the promise was kept in practice/);
  assert.match(many.limit, /published wording did not weaken/);
  assert.match(many.limit, /Checks passed: 13\./);
});

test("zero captures still produces the plural form rather than a broken sentence", () => {
  assert.equal(heldHeadline("0", 0).headline, "The commitment was unchanged across 0 archived captures.");
});
