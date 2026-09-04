/**
 * Regression coverage for the exact defect a live simulation and a live create_bond attempt both
 * hit during this project's evidence pass: `error instanceof Error ? error.message :
 * String(error)`, on the dry run and on the write path, rendering a thrown non-Error value as the
 * literal text "[object Object]" instead of whatever the wallet or the contract actually said.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeError } from "../src/lib/wallet-errors.ts";

test("a real Error keeps its own message", () => {
  assert.equal(normalizeError(new Error("a bond needs a stake; this call carried no value")),
    "a bond needs a stake; this call carried no value");
});

test("a plain thrown object never renders as [object Object]", () => {
  const result = normalizeError({ code: -32000, message: "execution reverted" });
  assert.equal(result, "execution reverted");
  assert.doesNotMatch(result, /\[object Object\]/);
});

test("a bare object with no recognised field still never renders as [object Object]", () => {
  assert.doesNotMatch(normalizeError({ foo: "bar" }), /\[object Object\]/);
  assert.doesNotMatch(normalizeError({}), /\[object Object\]/);
});

test("EIP-1193 user-rejection code 4001 reads as a calm cancellation", () => {
  assert.equal(normalizeError({ code: 4001, message: "User rejected the request." }),
    "Transaction rejected in wallet.");
  assert.equal(normalizeError({ code: "4001" }), "Transaction rejected in wallet.");
});

test("viem-style shortMessage wins over a noisy wrapping message on the same object", () => {
  const viemLike = { shortMessage: "Execution reverted.", message: "very long multi line dump" };
  assert.equal(normalizeError(viemLike), "Execution reverted.");
});

test("a nested cause is reached when the outer object has no usable field", () => {
  assert.equal(normalizeError({ cause: { message: "insufficient funds for gas" } }),
    "insufficient funds for gas");
});

test("a nested RPC error under data.message is reached", () => {
  assert.equal(normalizeError({ code: -32000, data: { message: "round is locked" } }),
    "round is locked");
});

test("a circular object still returns a safe, non-crashing string", () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => normalizeError(circular));
  assert.doesNotMatch(normalizeError(circular), /\[object Object\]/);
});

test("string, number, null and undefined all pass through safely", () => {
  assert.equal(normalizeError("plain string reason"), "plain string reason");
  assert.equal(normalizeError(""), "The request failed with no further detail.");
  assert.equal(normalizeError(42), "42");
  assert.equal(normalizeError(null), "The request failed with no further detail.");
  assert.equal(normalizeError(undefined), "The request failed with no further detail.");
});
