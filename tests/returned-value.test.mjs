/**
 * Whether a FINALIZED transaction was an acceptance or a refund, which are not the same fact.
 *
 * THE MEASUREMENT THIS FILE GUARDS. Transaction 0xc3a12dd2 sent 250,000,000,000,000,000 wei into
 * `create_bond` on StudioNet, reached a refusal one network call in, and resolved as a rollback. The
 * storage writes were undone. The transfer that funded the call was not, because a GenVM revert has
 * nothing to say about value that has already arrived. The stake sat in the contract against a bond
 * that never existed, and no method could pay it out.
 *
 * So `create_bond` and `contest_breach` became refusal boundaries: they catch `gl.vm.UserError`, emit
 * the refund, and RETURN the tagged sentence. The consequence for this layer is the whole reason the
 * layer exists. Those transactions now finalize with GenVM SUCCESS. `execution_result` says SUCCESS,
 * the rail says FINALIZED, and the request was refused. A reader who is shown only the first fact is
 * being told they own a bond they do not own.
 *
 * AND THE REGRESSION THAT MADE IT A TEST FILE. This module was carried over from a sibling project
 * whose contract answers with `[REJECTED] <reason>`, and it looked for exactly that prefix. Holdfast
 * has no `[REJECTED]` tag at all: its four are `[EXPECTED]`, `[EXTERNAL]`, `[TRANSIENT]` and
 * `[LLM_ERROR]`, and none of them starts a message reliably either, because half of them arrive
 * wrapped in a `Refusal(...)` repr. Every refused create would have been read as an acceptance. The
 * fix was to delete the prefix rule and defer to `findRefusal`, and the tests below are written so
 * that reintroducing a prefix rule of any kind fails.
 *
 * Every refusal string here was observed through the real GenVM SDK in `tests/direct/`, and both
 * success receipts are the contract's own format strings, read out of `contracts/Holdfast.py` rather
 * than invented, because "does this look like a refusal" is only a meaningful question against the
 * thing that really is not one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  refusalIn,
  returnedFromTransaction,
  returnedRefusal,
  returnedValue,
} from "../src/lib/genlayer/returned-value.ts";
import { OUTCOMES } from "../src/lib/lifecycle.ts";

const CONTRACT = readFileSync(new URL("../contracts/Holdfast.py", import.meta.url), "utf8");

/**
 * What an ACCEPTED `create_bond` returns, and it is the case a prefix rule gets wrong in the
 * dangerous direction. Long, specific, and carrying no tag.
 */
const CREATE_RECEIPT =
  "page-terms bonded 250000000000000000 wei on https://cloud.google.com/terms at 20260129024608, term 365 days to 0x81b6C1E4C0e2Bb0b4Bd0b8e6E19c46dC1D9a0000, cursor 20260129024608";

/** The same for `contest_breach`, whose receipt names a state the tag vocabulary does not. */
const CONTEST_RECEIPT =
  "page-terms CONTESTED: the promisor cites 20260801000000 at 20260802000000 and posted 50000000000000000 wei. Anyone may now call adjudicate_contest.";

/**
 * The four tags, one observed message each, one per outcome class. Driven off `OUTCOMES` in the
 * assertions so a fifth class cannot be added without a message being supplied for it.
 */
const REFUSALS = {
  expected: "[EXPECTED] a bond needs a stake; this call carried no value",
  external:
    "Refusal([EXTERNAL] cdx-empty: 200 with a 3 byte body and zero change points; this is absence of data, never absence of change)",
  transient:
    "Refusal([TRANSIENT] digest-mismatch: want FO4FOH4ODHA2OQAWMSTZX2GKFRFINKYI got 4MTV3WACV5B5KT3BBAPQSD5CWZ5WNET2 over 215912 stored bytes)",
  "llm-error":
    "[LLM_ERROR] the reading quoted an excerpt that is not in the document, so it was discarded",
};

/** `{status: 'return', payload: {readable: '"..."'}}` is the shape genlayer-js hands the app. */
function decodedReturn(text) {
  return { status: "return", payload: { readable: JSON.stringify(text) } };
}

/** The undecoded form: result code byte, then the calldata-encoded body. */
function base64Return(text, code = 0) {
  const body = Buffer.from(text, "utf8");
  // A length prefix ahead of the string, which is why the tag never sits at byte zero and why the
  // decoder searches rather than testing a prefix. The exact framing does not matter here; that
  // there IS framing does.
  const framed = Buffer.concat([Buffer.from([code, body.length & 0xff]), body]);
  return framed.toString("base64");
}

/* ------------------------------------------------------------------------- *
 * The regression: a returned refusal must be recognised as one
 * ------------------------------------------------------------------------- */

test("every tag the app renders copy for is recognised in a returned value", () => {
  // `OUTCOMES` is keyed by exactly the four error classes; `finding` is a verdict and has no tag,
  // so it is absent by construction rather than filtered out here.
  assert.deepEqual(
    Object.keys(REFUSALS).sort(),
    Object.keys(OUTCOMES).sort(),
    "a class in OUTCOMES has no observed message here, so this file is not covering it",
  );

  for (const [outcome, message] of Object.entries(REFUSALS)) {
    const found = returnedRefusal(returnedValue(decodedReturn(message)));
    assert.ok(found, message);
    assert.equal(found.outcome, outcome, message);
    assert.equal(found.tag, OUTCOMES[outcome].tag, message);
  }
});

test("the tag is found whether it leads the message or sits inside a Refusal repr", () => {
  // The two shapes, asserted through this module rather than through findRefusal directly, because
  // the base64 branch slices the body and a slice computed from the wrong index would lose the tag.
  const leading = refusalIn(base64Return(REFUSALS.expected));
  const wrapped = refusalIn(base64Return(REFUSALS.external));

  assert.equal(leading.tag, "[EXPECTED]");
  assert.equal(wrapped.tag, "[EXTERNAL]");
  assert.equal(REFUSALS.expected.startsWith(leading.tag), true);
  assert.equal(REFUSALS.external.startsWith(wrapped.tag), false);
  // And the reason survives the repr wrapper without its trailing parenthesis.
  assert.equal(wrapped.reason.startsWith("cdx-empty: 200 with a 3 byte body"), true);
  assert.equal(wrapped.reason.endsWith(")"), false);
});

test("the sibling project's [REJECTED] prefix is not this contract's vocabulary", () => {
  // The bug, stated as the assertion that would have caught it. This module used to test
  // `text.startsWith("[REJECTED]")`, and the contract has never emitted that tag, so every refused
  // create read as an acceptance.
  assert.equal(CONTRACT.includes("[REJECTED]"), false);

  // What makes the old rule worse than merely dead is that the bare word IS in this contract's
  // vocabulary, meaning something else entirely: a change point that failed a gate is summarised as
  // QUALIFIED or REJECTED. That is a verdict about one capture on a bond that exists, recorded on a
  // call that SUCCEEDED. A parser keyed on the word rather than on the four tags would read a
  // successful examination as a refusal.
  assert.ok(CONTRACT.includes('"QUALIFIED" if self.qualified else "REJECTED"'));
  assert.equal(returnedRefusal(returnedValue(decodedReturn("REJECTED 20230320142124"))), null);

  // And a message in the old bracketed shape is now reported as untagged rather than as a refusal,
  // because it carries none of the four tags this contract does emit.
  assert.equal(returnedRefusal(returnedValue(decodedReturn("[REJECTED] no stake"))), null);
});

/* ------------------------------------------------------------------------- *
 * The other direction, which is the one a prefix rule got wrong quietly
 * ------------------------------------------------------------------------- */

test("an accepted call's receipt is not read as a refusal", () => {
  for (const receipt of [CREATE_RECEIPT, CONTEST_RECEIPT]) {
    const value = returnedValue(decodedReturn(receipt));
    assert.equal(value.kind, "returned");
    assert.equal(value.text, receipt);
    assert.equal(returnedRefusal(value), null, receipt);
  }
});

test("the receipts above are the contract's own format strings and not invented for this test", () => {
  // Pinned against the source, so a reworded receipt makes this fail rather than leaving the
  // acceptance case testing a string the contract stopped producing.
  assert.ok(CONTRACT.includes('"%s bonded %d wei on %s at %s, term %d days to %s, cursor %s"'));
  assert.ok(
    CONTRACT.includes('"%s %s: the promisor cites %s at %s and posted %d wei. Anyone may now call "'),
  );
  // The second `%s` is a state constant rather than free text, and its value is read from the
  // source because writing it from memory got it wrong once.
  assert.ok(CONTRACT.includes('ST_CONTESTED = "CONTESTED"'));
  assert.ok(CONTEST_RECEIPT.includes(" CONTESTED: the promisor cites "));

  // The receipts carry no bracketed tag, which is the property that makes them safe to return.
  for (const receipt of [CREATE_RECEIPT, CONTEST_RECEIPT]) {
    for (const { tag } of Object.values(OUTCOMES)) {
      assert.equal(receipt.includes(tag), false, `${tag} in ${receipt}`);
    }
  }
});

test("an accepted receipt survives the base64 branch whole, framing bytes aside", () => {
  // The base64 decoder slices from the tag when it finds one. On a receipt there is no tag, so
  // nothing may be sliced: the receipt is the only record of what was escrowed and truncating it
  // to a guessed offset would lose the stake, the term and the cursor.
  const value = returnedValue(base64Return(CREATE_RECEIPT));
  assert.equal(value.kind, "returned");
  assert.ok(value.text.includes("bonded 250000000000000000 wei"));
  assert.ok(value.text.endsWith("cursor 20260129024608"));
  assert.equal(returnedRefusal(value), null);
});

/* ------------------------------------------------------------------------- *
 * A revert is a different event, and must not be reported as a refund
 * ------------------------------------------------------------------------- */

test("a rollback carrying the same words is not a returned refusal", () => {
  // The non-payable methods still raise, and their messages are identical in shape. Reporting one
  // as a returned refusal would tell the reader their value came back when no value was sent and
  // none came back. `rollback` and `contract_error` share `execution_result: 'ERROR'`, so `status`
  // is the only reliable distinguisher and both are asserted.
  for (const status of ["rollback", "contract_error", "error"]) {
    const value = returnedValue({ status, payload: REFUSALS.transient });
    assert.equal(value.kind, "reverted");
    assert.equal(value.message, REFUSALS.transient);
    assert.equal(returnedRefusal(value), null, status);
  }
});

test("the base64 revert codes are reverts and the return code is a return", () => {
  assert.equal(returnedValue(base64Return(REFUSALS.transient, 1)).kind, "reverted");
  assert.equal(returnedValue(base64Return(REFUSALS.transient, 2)).kind, "reverted");
  assert.equal(returnedValue(base64Return(REFUSALS.transient, 0)).kind, "returned");
});

/* ------------------------------------------------------------------------- *
 * Shapes that carry no answer, reported as such rather than as an acceptance
 * ------------------------------------------------------------------------- */

test("an unreadable receipt is unreadable and never a silent acceptance", () => {
  for (const result of [undefined, null, 42, [], { status: "mystery" }, { status: "return", payload: 7 }]) {
    const value = returnedValue(result);
    assert.equal(value.kind, "unreadable", JSON.stringify(result ?? null));
    assert.equal(returnedRefusal(value), null);
  }
  // Not base64 at all, which is what a truncated or re-encoded payload looks like.
  assert.equal(returnedValue("!!!not base64!!!").kind, "unreadable");
});

test("a void method returns nothing rather than something unreadable", () => {
  // `status: 'none'` and result code 4 are both "the method returned no value", which the five
  // non-payable writes do. An empty return is not a refusal and not a failure to decode.
  for (const result of [{ status: "none" }, { status: "return", payload: null }]) {
    assert.deepEqual(returnedValue(result), { kind: "returned", text: "" });
    assert.equal(returnedRefusal(returnedValue(result)), null);
  }
});

test("the leader receipt is found however deeply the client wrapped it", () => {
  const wrapped = {
    consensus_data: { leader_receipt: [{ result: decodedReturn(REFUSALS.external) }] },
  };
  assert.equal(returnedRefusal(returnedFromTransaction(wrapped)).tag, "[EXTERNAL]");

  // A single object rather than an array, which the RPC has been seen to return, and the shapes
  // that carry no receipt at all.
  const single = { consensus_data: { leader_receipt: { result: decodedReturn(CREATE_RECEIPT) } } };
  assert.equal(returnedFromTransaction(single).kind, "returned");
  for (const bad of [null, {}, { consensus_data: null }, { consensus_data: {} }]) {
    assert.equal(returnedFromTransaction(bad).kind, "unreadable");
  }
});
