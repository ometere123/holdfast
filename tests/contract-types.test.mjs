/**
 * The contract's bounds, the client's copy of them, and the machinery that keeps the copy honest.
 *
 * Two duplications in this module are load bearing and both are liabilities. `CLIENT_LIMITS` is a
 * hand written mirror of `get_limits()`, needed because the create form validates synchronously and
 * cannot await a read; `limitsDrift` is the thing that stops the mirror from quietly becoming a
 * second source of truth. `resolveLimits` is the seam where the contract's units become the units
 * the interface prints, and a unit mistake there is invisible: 86400 read as hours rather than
 * seconds is a plausible looking number on a page.
 *
 * `sameAddress` gets its own tests for a specific reason recorded in the module: comparing a
 * checksummed address from `Address.as_hex` against a wallet's casing with `===` is how a sibling
 * project shipped three deployments in which no payee could act on their own bond.
 *
 * The wording tables are tested for shape rather than prose, plus a small number of exact claims
 * that must not drift, including the withdrawn gate measurement.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOND_STATES,
  BOND_STATE_TEXT,
  CLIENT_LIMITS,
  CONSENSUS_STAGES,
  CONTEST_OUTCOME_TEXT,
  ENCODING_TEXT,
  GATE_TEXT,
  READING_TEXT,
  RETRYABLE_STAGES,
  TERMINAL_STAGES,
  limitsDrift,
  resolveLimits,
  sameAddress,
} from "../src/lib/contract-types.ts";

const MODULE_SOURCE = readFileSync(new URL("../src/lib/contract-types.ts", import.meta.url), "utf8");

/**
 * A `get_limits()` record that agrees with the mirror exactly.
 *
 * Every field is a string, because that is how the contract publishes them, and the three that
 * carry a different unit from the one the interface prints are written in the contract's unit:
 * seconds for the interval and the window, basis points for the contest bond.
 */
function limits(overrides = {}) {
  return {
    min_term_days: "30",
    max_term_days: "1095",
    min_commitment_chars: "40",
    max_commitment_chars: "400",
    min_anchor_words: "3",
    max_anchor_words: "12",
    min_change_points: "3",
    breach_run_length: "2",
    check_interval_seconds: "86400",
    contest_window_seconds: "604800",
    contest_bond_basis_points: "1000",
    cdx_warc_length_max: "250000",
    raw_max_bytes: "2500000",
    decoded_max_bytes: "4000000",
    max_points_per_check: "8",
    gate_a_enabled: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------------- *
 * The mirror, checked against a contract record that agrees with it
 * ------------------------------------------------------------------------- */

test("the client mirror agrees with the contract's own published bounds, in every field", () => {
  // The test the mirror exists to keep true. If this ever fails, the numbers in `CLIENT_LIMITS` are
  // the ones to change, not the fixture: the contract is the authority.
  assert.deepEqual(limitsDrift(limits()), []);
});

test("a moved constant is reported by name, in the interface's unit and not the contract's", () => {
  const drift = limitsDrift(limits({ max_points_per_check: "4", contest_bond_basis_points: "2500" }));
  assert.deepEqual(drift, [
    { field: "maxPointsPerCheck", client: 8, contract: 4 },
    { field: "contestBondPct", client: 10, contract: 25 },
  ]);
  // 2500 basis points is reported as 25, not as 2500, because a reader comparing "10" against
  // "2500" learns nothing about whether the two agree.
});

test("each of the three converted fields is compared after conversion, not before", () => {
  // The failure this catches: comparing 24 against 86400 reports a disagreement on a contract that
  // agrees, and every page then prints a drift banner that is never true and is soon ignored.
  assert.deepEqual(limitsDrift(limits({ check_interval_seconds: "43200" })), [
    { field: "checkIntervalHours", client: 24, contract: 12 },
  ]);
  assert.deepEqual(limitsDrift(limits({ contest_window_seconds: "1209600" })), [
    { field: "contestWindowDays", client: 7, contract: 14 },
  ]);
  assert.deepEqual(limitsDrift(limits({ contest_bond_basis_points: "250" })), [
    { field: "contestBondPct", client: 10, contract: 2.5 },
  ]);
});

test("a limit that does not parse is a disagreement rather than a silent agreement", () => {
  // `Number("nonsense")` is NaN, and NaN fails every comparison including `!==`, so an unparseable
  // field could as easily have vanished from the report. It is named instead.
  const drift = limitsDrift(limits({ min_change_points: "nonsense" }));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].field, "minChangePoints");
  assert.equal(drift[0].client, 3);
  assert.ok(Number.isNaN(drift[0].contract));
});

test("every field in the mirror that the contract also publishes is compared, and none is skipped", () => {
  // Fifteen of the nineteen mirror fields have a contract equivalent. Driving every one of them out
  // of range at once is the only way to notice a pair that was never added to the list: a field
  // that is validated against but never compared is exactly the drift this cannot catch.
  const wrong = limitsDrift(
    limits({
      min_commitment_chars: "1",
      max_commitment_chars: "2",
      min_anchor_words: "3000",
      max_anchor_words: "4000",
      min_term_days: "5",
      max_term_days: "6",
      min_change_points: "7",
      breach_run_length: "8",
      max_points_per_check: "9",
      cdx_warc_length_max: "10",
      raw_max_bytes: "11",
      decoded_max_bytes: "12",
      check_interval_seconds: "13",
      contest_window_seconds: "14",
      contest_bond_basis_points: "15",
    }),
  );
  assert.equal(wrong.length, 15);
  assert.deepEqual(wrong.map((entry) => entry.field).sort(), [
    "anchorWordsMax",
    "anchorWordsMin",
    "breachRunLength",
    "cdxLengthCap",
    "checkIntervalHours",
    "commitmentMax",
    "commitmentMin",
    "contestBondPct",
    "contestWindowDays",
    "decodedCap",
    "maxPointsPerCheck",
    "minChangePoints",
    "rawCap",
    "termDaysMax",
    "termDaysMin",
  ]);
  // The four with no contract equivalent are not in the report, because there is nothing to
  // disagree with.
  const reported = new Set(wrong.map((entry) => entry.field));
  for (const clientOnly of ["anchorWordMin", "anchorWordMax", "termDaysDefault", "consensusEnvelope"]) {
    assert.ok(!reported.has(clientOnly), clientOnly);
  }
});

/* ------------------------------------------------------------------------- *
 * Resolving
 * ------------------------------------------------------------------------- */

test("resolving nothing yields the mirror and says so, because a page has to print which it is", () => {
  const resolved = resolveLimits();
  assert.equal(resolved.source, "client");
  for (const [field, value] of Object.entries(CLIENT_LIMITS)) {
    assert.equal(resolved[field], value, field);
  }
  // `source` is the only key added, so a resolved record cannot quietly grow a field the mirror
  // does not have.
  assert.deepEqual(Object.keys(resolved).sort(), [...Object.keys(CLIENT_LIMITS), "source"].sort());
});

test("resolving a contract record converts seconds to hours and days, and basis points to percent", () => {
  const resolved = resolveLimits(limits());
  assert.equal(resolved.source, "contract");
  assert.equal(resolved.checkIntervalHours, 24);
  assert.equal(resolved.contestWindowDays, 7);
  assert.equal(resolved.contestBondPct, 10);
  // And a record that agrees with the mirror resolves to the mirror's numbers, which is what makes
  // the drift check and the resolver two views of one fact rather than two implementations.
  for (const [field, value] of Object.entries(CLIENT_LIMITS)) {
    assert.equal(resolved[field], value, field);
  }
});

test("the converted fields follow the contract when it disagrees, rather than the mirror", () => {
  const resolved = resolveLimits(
    limits({ check_interval_seconds: "21600", contest_window_seconds: "259200", contest_bond_basis_points: "500" }),
  );
  assert.equal(resolved.checkIntervalHours, 6);
  assert.equal(resolved.contestWindowDays, 3);
  assert.equal(resolved.contestBondPct, 5);
});

test("gate_a_enabled does not become a limit, because it is a switch and not a bound", () => {
  // It travels on `Limits` and is read separately by the pages that name which gates decided.
  // Folding it into a numeric record would make it a number.
  assert.equal(resolveLimits(limits({ gate_a_enabled: true })).gate_a_enabled, undefined);
  assert.equal(CLIENT_LIMITS.gate_a_enabled, undefined);
});

test("the four client-only fields survive a contract record untouched", () => {
  const resolved = resolveLimits(limits());
  assert.equal(resolved.anchorWordMin, 3);
  assert.equal(resolved.anchorWordMax, 64);
  assert.equal(resolved.termDaysDefault, 365);
  // A measurement of StudioNet rather than a contract constant, so no published limit may move it.
  assert.equal(resolved.consensusEnvelope, 5647099);
});

test("an unparseable limit falls back to the mirror instead of resolving to NaN", () => {
  // A NaN bound compares false against everything, so a form validating against one accepts
  // anything. Falling back to the mirror is wrong too, but it is wrong in the safe direction and
  // `limitsDrift` reports the field, so the page says the two disagree.
  const resolved = resolveLimits(limits({ max_commitment_chars: "four hundred" }));
  assert.equal(resolved.commitmentMax, 400);
  assert.equal(resolved.source, "contract");
  assert.equal(limitsDrift(limits({ max_commitment_chars: "four hundred" })).length, 1);
});

test("an empty limit falls back too, rather than resolving to a bound of zero", () => {
  // `Number("")` is 0 and 0 is finite, so this is the branch a plain `Number.isFinite` guard misses.
  // A commitment minimum of 0 accepts an empty commitment; a maximum of 0 rejects every one.
  const resolved = resolveLimits(limits({ min_commitment_chars: "", max_points_per_check: "   " }));
  assert.equal(resolved.commitmentMin, 40);
  assert.equal(resolved.maxPointsPerCheck, 8);
  // The converted fields fall back in the contract's unit and are divided afterwards, so an empty
  // interval resolves to 24 hours and not to 86400 of them.
  assert.equal(resolveLimits(limits({ check_interval_seconds: "" })).checkIntervalHours, 24);
  assert.equal(resolveLimits(limits({ contest_window_seconds: "" })).contestWindowDays, 7);
  assert.equal(resolveLimits(limits({ contest_bond_basis_points: "" })).contestBondPct, 10);
});

test("a published zero is honoured, because zero is a number the contract may mean", () => {
  // The distinction the fallback rests on: "" is a missing answer, "0" is an answer. A contract
  // that published a zero interval means every check is allowed, and the interface must say so
  // rather than quietly reinstating a day.
  assert.equal(resolveLimits(limits({ check_interval_seconds: "0" })).checkIntervalHours, 0);
  assert.equal(resolveLimits(limits({ min_change_points: "0" })).minChangePoints, 0);
});

/* ------------------------------------------------------------------------- *
 * Addresses
 * ------------------------------------------------------------------------- */

test("two spellings of one address are the same address, whatever the casing", () => {
  const checksummed = "0x81b6C8b2f7F0a1C3d4E5f60718293a4B5c6D7e8F";
  assert.equal(sameAddress(checksummed, checksummed.toLowerCase()), true);
  assert.equal(sameAddress(checksummed, checksummed.toUpperCase().replace("0X", "0x")), true);
  assert.equal(sameAddress(checksummed, checksummed), true);
});

test("surrounding whitespace is not a different address", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  assert.equal(sameAddress(`  ${address}`, `${address}\n`), true);
});

test("two different addresses are different, including one that differs in a single digit", () => {
  assert.equal(
    sameAddress("0x1234567890abcdef1234567890abcdef12345678", "0x1234567890abcdef1234567890abcdef12345679"),
    false,
  );
});

test("a missing or empty side is never a match, which is what keeps a disconnected wallet powerless", () => {
  // The default has to be false. A comparison that returned true on `undefined` would show every
  // promisor-only control to a reader who has not connected anything.
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  assert.equal(sameAddress(undefined, address), false);
  assert.equal(sameAddress(address, undefined), false);
  assert.equal(sameAddress(undefined, undefined), false);
  assert.equal(sameAddress("", address), false);
  assert.equal(sameAddress(address, ""), false);
  // Two empties are not equal to each other either, though `===` would have said they were.
  assert.equal(sameAddress("", ""), false);
});

/* ------------------------------------------------------------------------- *
 * The wording tables
 * ------------------------------------------------------------------------- */

test("every state, reading and outcome pairs a meaning with a limit, and neither is empty", () => {
  // The rule the tables exist for: a sentence that says only what something proves invites the
  // reader to supply the rest themselves.
  const tables = { BOND_STATE_TEXT, READING_TEXT, CONTEST_OUTCOME_TEXT };
  for (const [name, table] of Object.entries(tables)) {
    for (const [key, entry] of Object.entries(table)) {
      assert.ok(entry.meaning.length > 20, `${name}.${key} meaning`);
      assert.ok(entry.limit.length > 20, `${name}.${key} limit`);
    }
  }
});

test("the five states in the text table are the five states, with nothing extra and nothing missing", () => {
  assert.deepEqual(Object.keys(BOND_STATE_TEXT).sort(), [...BOND_STATES].sort());
  assert.equal(BOND_STATES.length, 5);
});

test("an active bond's limit refuses the reading a reader would otherwise supply", () => {
  // The single most load bearing sentence in the table. ACTIVE means no qualified capture showed a
  // weakening, and reads to almost everybody as "this company is keeping its promise".
  assert.match(BOND_STATE_TEXT.ACTIVE.limit, /not a statement about conduct/);
  assert.match(BOND_STATE_TEXT.RETURNED.limit, /does not follow that the promise was kept in practice/);
  assert.match(BOND_STATE_TEXT.BREACHED.limit, /not a legal determination/);
});

test("the four readings are the four, and an unresolved one is explicitly not a finding", () => {
  assert.deepEqual(Object.keys(READING_TEXT).sort(), ["ABSENT", "HOLDS", "INDETERMINATE", "WEAKENED"]);
  assert.match(READING_TEXT.INDETERMINATE.limit, /not a finding and is never treated as one/);
  // One weakened capture is not a claim: the run length is what makes it one.
  assert.match(READING_TEXT.WEAKENED.limit, /Two consecutive qualified ones are required/);
  // And a restatement in different words holds, which is the difference between this and a diff.
  assert.match(READING_TEXT.HOLDS.limit, /different words holds/);
  assert.match(READING_TEXT.ABSENT.limit, /not proof of abandonment/);
});

test("the contest outcome table has the two real outcomes and not the empty third", () => {
  // `""` is a `ContestOutcome` and means no adjudication has happened, which is not an outcome to
  // describe. A table entry for it would print a verdict on a contest nobody has judged.
  assert.deepEqual(Object.keys(CONTEST_OUTCOME_TEXT).sort(), ["FAILED", "UPHELD"]);
  assert.equal(CONTEST_OUTCOME_TEXT[""], undefined);
});

test("the four encodings include the empty one, and none of them is raw deflate", () => {
  assert.deepEqual(Object.keys(ENCODING_TEXT).sort(), ["", "gzip", "identity", "zlib"]);
  for (const [key, text] of Object.entries(ENCODING_TEXT)) assert.ok(text.length > 20, key || "(empty)");
  // The absence is deliberate and documented: raw inflate does not fail on either measured
  // non-deflate shape, it returns one byte, so a branch for it would produce a plausible empty
  // document that every validator agrees on.
  for (const text of Object.values(ENCODING_TEXT)) assert.ok(!/deflate/i.test(text));
  // An empty encoding is the one that says nothing was read, not a fourth compression format.
  assert.match(ENCODING_TEXT[""], /nothing was read from these bytes/);
  assert.match(ENCODING_TEXT.gzip, /1f8b/);
  assert.match(ENCODING_TEXT.zlib, /78/);
});

/* ------------------------------------------------------------------------- *
 * The gates, and the measurement that was withdrawn
 * ------------------------------------------------------------------------- */

test("there are four gates, each with a label and a meaning", () => {
  assert.deepEqual(Object.keys(GATE_TEXT).sort(), ["A", "B", "C", "D"]);
  for (const [key, gate] of Object.entries(GATE_TEXT)) {
    assert.ok(gate.label.length > 0, key);
    assert.ok(gate.meaning.length > 40, key);
  }
});

test("gate A carries the measurement that turned it off, with both figures", () => {
  // The one thing about the gates that was actually measured, and it is a false positive. Printing
  // the gate without it would present a disabled safeguard as an oversight.
  assert.match(GATE_TEXT.A.meaning, /Off by default/);
  assert.match(GATE_TEXT.A.meaning, /2,738/);
  assert.match(GATE_TEXT.A.meaning, /35,689/);
  assert.match(GATE_TEXT.A.meaning, /would have rejected the unchanged version/);
});

test("gate B is about the anchor derived from the URL, and gate D about independence", () => {
  // B tests the phrase derived from the URL's last path segment, not the promisor's commitment. A
  // meaning that said "commitment" would describe the reading step instead.
  assert.match(GATE_TEXT.B.meaning, /derived from the URL/);
  assert.ok(!/commitment/i.test(GATE_TEXT.B.meaning));
  assert.match(GATE_TEXT.D.meaning, /independent of the anchor and every section/);
  assert.match(GATE_TEXT.D.meaning, /a gate that cannot fail on its own is not a gate/);
});

test("the module states that gates B, C and D have no measured true positive", () => {
  // The withdrawal, asserted rather than trusted. An earlier version of this file claimed each of
  // the three caught 4 of 4 known-bad snapshots. That number came from a measuring script that
  // fetched the `id_` replay and never decompressed it, so four faithful gzip captures were graded
  // as binary. All four qualify on decode alone.
  assert.ok(MODULE_SOURCE.includes("B, C and D have no measured true positive"));
  // Matched within one line, because the comment is wrapped and a phrase that spans a break carries
  // ` * ` in the middle of it.
  assert.ok(MODULE_SOURCE.includes("fetched the `id_` replay and never decompressed it"));
  // And the retracted figure appears nowhere except inside that retraction.
  for (const claim of ["4 of 4", "4/4", "caught four of four"]) {
    const occurrences = MODULE_SOURCE.split(claim).length - 1;
    if (occurrences > 0) {
      assert.ok(
        MODULE_SOURCE.includes(`claimed they each caught ${claim} known-bad snapshots`),
        `"${claim}" appears outside the retraction`,
      );
      assert.equal(occurrences, 1, `"${claim}" appears ${occurrences} times`);
    }
  }
});

/* ------------------------------------------------------------------------- *
 * Stages
 * ------------------------------------------------------------------------- */

test("the rail draws six stages, in the order a write walks them", () => {
  assert.deepEqual([...CONSENSUS_STAGES], [
    "PENDING",
    "PROPOSING",
    "COMMITTING",
    "REVEALING",
    "ACCEPTED",
    "FINALIZED",
  ]);
  // ACCEPTED is not the end. The refund message on a rejected payable call dispatches with
  // `onAcceptance: false`, so a balance assertion made at ACCEPTED reads the wrong number.
  assert.equal(CONSENSUS_STAGES[CONSENSUS_STAGES.length - 1], "FINALIZED");
});

test("a stage that means try again is never drawn on the rail", () => {
  // A retryable stage is the reel stopping, not the reel showing something, so it has no bar. If
  // one leaked into the ordered list it would render as progress towards a finding.
  for (const stage of RETRYABLE_STAGES) {
    assert.ok(!CONSENSUS_STAGES.includes(stage), stage);
  }
  assert.deepEqual([...RETRYABLE_STAGES].sort(), ["LEADER_TIMEOUT", "UNDETERMINED", "VALIDATORS_TIMEOUT"]);
});

test("no stage is both retryable and terminal, because the two prescribe opposite things", () => {
  for (const stage of RETRYABLE_STAGES) assert.ok(!TERMINAL_STAGES.has(stage), stage);
  for (const stage of TERMINAL_STAGES) assert.ok(!RETRYABLE_STAGES.has(stage), stage);
  assert.deepEqual([...TERMINAL_STAGES].sort(), ["CANCELED", "FINALIZED"]);
  // FINALIZED is the one stage that is both on the rail and terminal: the rail ends where polling
  // does.
  assert.ok(CONSENSUS_STAGES.includes("FINALIZED"));
  assert.ok(!CONSENSUS_STAGES.includes("CANCELED"));
});
