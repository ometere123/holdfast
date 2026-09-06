/**
 * Regression coverage for a live rollback losing its own reason. A `check_commitment` call on
 * StudioNet finalized with the leader receipt reading `execution_result: "ROLLBACK"` and
 * `error: "[EXTERNAL] the index answered with 1 row(s) ... and none is newer than the cursor"`.
 * `assertSuccessfulGenVMExecution` threw only `GenLayer contract execution failed (ROLLBACK).
 * Transaction: 0x...`, discarding the tagged sentence, which is the one part of that message a
 * reader could act on -- and it fed `classify()` a string with no tag in it, so a retryable
 * [EXTERNAL] refusal read on screen as an unretryable "expected" one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { assertSuccessfulGenVMExecution, inspectGenVMExecution } from "../src/lib/genlayer/execution.ts";

function txWith(executionResult, error) {
  return { consensus_data: { leader_receipt: [{ execution_result: executionResult, error }] } };
}

test("inspectGenVMExecution reads the result and the error off the leader receipt", () => {
  const outcome = inspectGenVMExecution(txWith("ROLLBACK", "[EXTERNAL] none newer than the cursor"));
  assert.equal(outcome.executionResult, "ROLLBACK");
  assert.equal(outcome.executionError, "[EXTERNAL] none newer than the cursor");
});

test("a missing or unrecognised result reads as UNKNOWN", () => {
  assert.equal(inspectGenVMExecution(null).executionResult, "UNKNOWN");
  assert.equal(inspectGenVMExecution(txWith("SOMETHING_ELSE")).executionResult, "UNKNOWN");
});

test("assertSuccessfulGenVMExecution passes a SUCCESS receipt through unchanged", () => {
  const outcome = assertSuccessfulGenVMExecution(txWith("SUCCESS", null), "0xhash");
  assert.equal(outcome.executionResult, "SUCCESS");
});

test("a ROLLBACK throws the leader's own tagged reason, not a generic wrapper", () => {
  const tx = txWith(
    "ROLLBACK",
    "[EXTERNAL] the index answered with 1 row(s) for the bonded page and none is newer than the cursor",
  );
  assert.throws(
    () => assertSuccessfulGenVMExecution(tx, "0x62533b50"),
    (error) => {
      assert.match(error.message, /^\[EXTERNAL\] the index answered with 1 row\(s\)/);
      assert.match(error.message, /0x62533b50/);
      assert.doesNotMatch(error.message, /GenVM execution failed \(ROLLBACK\)/);
      return true;
    },
  );
});

test("a rollback with no reason on the receipt falls back to the generic wrapper", () => {
  assert.throws(
    () => assertSuccessfulGenVMExecution(txWith("ROLLBACK", null), "0xhash"),
    /GenLayer contract execution failed \(ROLLBACK\)\. Transaction: 0xhash/,
  );
});

test("an ERROR result behaves the same way as a ROLLBACK", () => {
  assert.throws(
    () => assertSuccessfulGenVMExecution(txWith("ERROR", "[TRANSIENT] validators disagreed"), "0xhash"),
    /\[TRANSIENT\] validators disagreed/,
  );
});
