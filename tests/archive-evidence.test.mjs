/**
 * The measurements the method page cites, and the two that were withdrawn.
 *
 * This module holds no invented data, which makes it the one file in the project where a stale number
 * is a false claim about the world rather than a wrong fixture. The tests below are the second
 * version of this file. The first version checked that the numbers were consistent with each other,
 * and eighteen of them passed on a table whose rows had been recombined: real decoded byte counts
 * attributed to the wrong pages, with raw counts copied out of the invented-bond module. Internal
 * consistency cannot detect that. Only reading the artefact can.
 *
 * So the central test here opens every capture named in the table and re-derives its raw length, its
 * decoded length and its encoding from the bytes on disk. The rest of the file guards the two
 * published retractions, `TABLE_CORRECTION` and `GATE_MEASUREMENT`, against drifting back into being
 * asserted as standing claims.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import {
  DECODE_BRANCHES,
  GATE_A_EVIDENCE,
  GATE_MEASUREMENT,
  GZIP_EVIDENCE,
  NO_RAW_DEFLATE_BRANCH,
  SYNTHETIC_NEGATIVE,
  TABLE_CORRECTION,
} from "../src/lib/archive-evidence.ts";

const CONTRACT_LINES = readFileSync(new URL("../contracts/Holdfast.py", import.meta.url), "utf8").split("\n");
const MODULE_SOURCE = readFileSync(new URL("../src/lib/archive-evidence.ts", import.meta.url), "utf8");

const FIXTURE_DIR = new URL("./fixtures/holdfast/", import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL("manifest.json", FIXTURE_DIR), "utf8"));
const ROUTES = new Map(MANIFEST.routes.map((route) => [route.name, route]));

/** The 1-indexed line a citation points at, as the contract actually has it. */
function contractLine(number) {
  return CONTRACT_LINES[number - 1] ?? "";
}

/**
 * A capture's bytes, and what they are when decoded, derived here rather than read from the table.
 *
 * The same three-branch dispatch the contract performs at Holdfast.py:847, reimplemented in Node so
 * that the table is checked by something other than the code that produced it. Reading the decoded
 * length out of the manifest instead would only prove the table and the manifest agree.
 */
function measure(fixture) {
  const raw = readFileSync(new URL(fixture, FIXTURE_DIR));
  const magic = raw.subarray(0, 2).toString("hex");
  if (magic === "1f8b") return { raw, magic, encoding: "gzip", decoded: gunzipSync(raw).length };
  if (raw[0] === 0x78) return { raw, magic, encoding: "zlib", decoded: inflateSync(raw).length };
  return { raw, magic, encoding: "identity", decoded: raw.length };
}

/* ------------------------------------------------------------------------- *
 * The seven real captures, checked against the files they name
 * ------------------------------------------------------------------------- */

test("every row is re-derived from the capture it names, which is the check the old table evaded", () => {
  // The load bearing test of this file. A row whose numbers were measured off a different page fails
  // here and cannot fail anywhere else, because every other property of a recombined table is the
  // property a correct table has.
  assert.equal(GZIP_EVIDENCE.length, 7);
  for (const row of GZIP_EVIDENCE) {
    const found = measure(row.fixture);
    assert.equal(String(found.raw.length), row.raw, `${row.fixture} raw`);
    assert.equal(String(found.decoded), row.decoded, `${row.fixture} decoded`);
    assert.equal(found.encoding, row.encoding, `${row.fixture} encoding`);
  }
});

test("each row's capture timestamp is the one the fixture manifest routes it at", () => {
  // Ties the second identifier as well. A row could name the right file and the wrong capture date,
  // and the byte counts would still reconcile because they came off that file.
  for (const row of GZIP_EVIDENCE) {
    const route = [...ROUTES.values()].find((entry) => entry.body === row.fixture);
    assert.ok(route, `no manifest route serves ${row.fixture}`);
    assert.ok(
      route.url.includes(`/web/${row.timestamp}id_/`),
      `${row.fixture}: table says ${row.timestamp}, manifest routes ${route.url}`,
    );
    // And the page named in the table is the page the archived URL points at.
    assert.ok(route.url.endsWith(row.page) || route.url.includes(`${row.page}/`), `${row.fixture}: ${row.page}`);
  }
});

test("five captures are compressed and two are not, reconciling with the eight on disk", () => {
  const gzip = GZIP_EVIDENCE.filter((row) => row.encoding === "gzip");
  const identity = GZIP_EVIDENCE.filter((row) => row.encoding === "identity");
  assert.equal(gzip.length, 5);
  assert.equal(identity.length, 2);
  // Seven real plus the one synthetic accounts for the eight the decode branches are counted over.
  assert.equal(GZIP_EVIDENCE.length + 1, 8);
  assert.ok(!GZIP_EVIDENCE.some((row) => row.fixture === SYNTHETIC_NEGATIVE.file));
});

test("the uncompressed control is the same page as a compressed row, not a different site", () => {
  // The control's whole job is to show that the identity branch is a real case. A control taken from
  // another site would also be showing that the other site serves things differently. Both identity
  // captures are pages that appear compressed elsewhere in the same table.
  const compressedPages = new Set(GZIP_EVIDENCE.filter((row) => row.encoding === "gzip").map((row) => row.page));
  for (const row of GZIP_EVIDENCE.filter((row) => row.encoding === "identity")) {
    assert.ok(compressedPages.has(row.page), `${row.page} has no compressed counterpart`);
    assert.equal(row.raw, row.decoded, row.page);
  }
});

test("no row claims zero readable characters undecoded, because the measurement is not zero", () => {
  // The corrected finding, asserted as a floor rather than a value so it stays true if the extraction
  // changes. Compressed bytes through a utf-8 replace decode yield tens of thousands of characters,
  // so a build that skipped decompression would pass an emptiness check and a length check.
  for (const row of GZIP_EVIDENCE) {
    const chars = Number(row.undecodedChars);
    assert.ok(chars > 20000, `${row.fixture}: ${row.undecodedChars}`);
  }
  assert.ok(!GZIP_EVIDENCE.some((row) => row.undecodedChars === "0"));
});

test("the zero that carries the argument is the section count, wherever sections were declared", () => {
  // Not one declared section survives in any compressed capture. That is the reading a validator set
  // would have reached unanimously, and it is a different failure from an empty document.
  const scored = GZIP_EVIDENCE.filter((row) => /^\d+ of \d+$/.test(row.sectionsUndecoded));
  assert.equal(scored.length, 4);
  for (const row of scored) {
    assert.match(row.sectionsUndecoded, /^0 of [1-9]/, row.fixture);
    assert.equal(row.encoding, "gzip", row.fixture);
    // And the manifest declares that many sections for the same route, so the denominator is real.
    const route = [...ROUTES.values()].find((entry) => entry.body === row.fixture);
    assert.equal(`0 of ${route.expect.sections.length}`, row.sectionsUndecoded, row.fixture);
  }
  // The three unscored rows say why they are unscored rather than showing a blank cell.
  for (const row of GZIP_EVIDENCE.filter((row) => !/^\d+ of \d+$/.test(row.sectionsUndecoded))) {
    assert.match(row.sectionsUndecoded, /nothing compressed|no sections declared/, row.fixture);
  }
});

test("every compressed replay inflates, and none of the ratios is a placeholder", () => {
  const ratios = [];
  for (const row of GZIP_EVIDENCE) {
    assert.match(row.timestamp, /^\d{14}$/, row.page);
    if (row.encoding !== "gzip") continue;
    const ratio = Number(row.decoded) / Number(row.raw);
    // Measured span across the five: 4.89x to 11.42x. A value outside that is a copied number.
    assert.ok(ratio > 4.5 && ratio < 12, `${row.fixture}: ${ratio.toFixed(2)}x`);
    ratios.push(ratio);
  }
  assert.equal(ratios.length, 5);
});

test("the largest payloads sit inside the caps, and the prose names the right one for each", () => {
  const gzipRows = GZIP_EVIDENCE.filter((row) => row.encoding === "gzip");
  // Largest inflated: the AWS service terms. This is the number the old table credited to OpenAI.
  const largestInflated = Math.max(...gzipRows.map((row) => Number(row.decoded)));
  assert.equal(largestInflated, 1056588);
  assert.equal(gzipRows.find((row) => Number(row.decoded) === largestInflated).page, "aws.amazon.com/service-terms");
  // Largest decoded overall is an uncompressed capture, which is why the cap is not a gzip concern.
  const largestOverall = Math.max(...GZIP_EVIDENCE.map((row) => Number(row.decoded)));
  assert.equal(largestOverall, 2044592);
  assert.ok(largestOverall < 4194304, "the decoded cap would have refused a real capture");
});

test("the captures are listed in the order they were archived", () => {
  const stamps = GZIP_EVIDENCE.map((row) => row.timestamp);
  assert.deepEqual(stamps, [...stamps].sort());
  assert.equal(new Set(stamps).size, stamps.length);
});

/* ------------------------------------------------------------------------- *
 * The table's own retraction
 * ------------------------------------------------------------------------- */

test("the withdrawn attribution is reachable, and none of it is still asserted as a measurement", () => {
  // Same discipline as the gate withdrawal: the wrong claim stays legible, and the specific wrong
  // values are pinned out of the live table by name and by number.
  assert.match(TABLE_CORRECTION.withdrawnClaim, /gnu\.org/);
  assert.match(TABLE_CORRECTION.withdrawnClaim, /policies\.google\.com/);
  for (const page of GZIP_EVIDENCE.map((row) => row.page)) {
    assert.ok(!/gnu\.org|policies\.google\.com|github\.com\/site\/terms/.test(page), page);
  }
  // The four raw counts that had been copied out of the invented-bond module.
  const raws = new Set(GZIP_EVIDENCE.map((row) => row.raw));
  for (const wrong of ["47441", "134882", "108224", "74405"]) {
    assert.ok(!raws.has(wrong), `${wrong} is back in the table`);
  }
});

test("the correction names the mechanism and the contradiction, not just the fact of being wrong", () => {
  assert.match(TABLE_CORRECTION.cause, /rotated by one position/);
  assert.match(TABLE_CORRECTION.cause, /copied out of mock-data\.ts/);
  // The contradiction is the generalisable part: two published claims disagreed and both were tested.
  assert.match(TABLE_CORRECTION.tell, /published as 0/);
  assert.match(TABLE_CORRECTION.tell, /zero of N sections/);
  assert.match(TABLE_CORRECTION.standing, /names the fixture it was measured from/);
  assert.equal(TABLE_CORRECTION.testsThatPassedOnTheWrongTable, 18);
});

test("the lesson is stated in the module header, where the next person editing the table will read it", () => {
  assert.match(MODULE_SOURCE, /EVERY ROW NAMES ITS ARTEFACT/);
  assert.match(MODULE_SOURCE, /IT IS NOT ZERO, AND THAT IS THE FINDING/);
});

test("the one fixture whose filename still carries a withdrawn word is the one the manifest renamed", () => {
  // `snap-gcp-deprecation-incomplete.bin` is not incomplete: it decodes cleanly. The route was renamed
  // and the file was not, because five build scripts open it by name. Asserted in both directions so
  // the mismatch stays a documented decision rather than becoming a stale reference nobody checked.
  const route = ROUTES.get("snap-gcp-deprecation-gzip");
  assert.ok(route, "the manifest no longer carries the renamed route");
  assert.equal(route.body, "snap-gcp-deprecation-incomplete.bin");
  assert.equal(route.expect.renamed_from, "snap-gcp-deprecation-incomplete");
  assert.ok(GZIP_EVIDENCE.some((row) => row.fixture === route.body));
  // And the word is false about the bytes, which is why it is withdrawn: the member is complete.
  assert.equal(measure(route.body).decoded, 696794);
  assert.match(MODULE_SOURCE, /ONE FILENAME CONTAINS A WITHDRAWN WORD/);
});

/* ------------------------------------------------------------------------- *
 * The three branches, and the fourth that is deliberately missing
 * ------------------------------------------------------------------------- */

test("there are exactly three decode branches and none of them is raw deflate", () => {
  assert.equal(DECODE_BRANCHES.length, 3);
  assert.deepEqual(DECODE_BRANCHES.map((branch) => branch.branch), ["gzip", "zlib", "identity"]);
  assert.deepEqual(DECODE_BRANCHES.map((branch) => branch.magic), ["1f8b", "78", "other"]);
  for (const branch of DECODE_BRANCHES) assert.ok(branch.note.length > 20, branch.branch);
});

test("the eight captured payloads are accounted for six and two, matching the two magic numbers", () => {
  assert.match(DECODE_BRANCHES[0].note, /Six of the eight/);
  assert.match(DECODE_BRANCHES[2].note, /Two of the eight/);
  assert.match(DECODE_BRANCHES[2].note, /3c21/);
  // And the split is checkable against the files rather than only stated: five real gzip plus the
  // synthetic is six, and the two identity rows are the two.
  const gzipOnDisk = GZIP_EVIDENCE.filter((row) => measure(row.fixture).magic === "1f8b").length;
  assert.equal(gzipOnDisk + 1, 6);
  assert.equal(measure(SYNTHETIC_NEGATIVE.file).magic, "1f8b");
});

test("the missing branch is refused on measurement, and the measurement is that it does not raise", () => {
  // The reason a fourth branch is worse than no fourth branch. Both shapes actually tried come back
  // from a raw inflate with one byte of output and no exception, so the branch would hand back a
  // plausible near-empty document and every validator would agree on it.
  assert.equal(NO_RAW_DEFLATE_BRANCH.length, 2);
  for (const attempt of NO_RAW_DEFLATE_BRANCH) {
    assert.match(attempt.result, /returned 1 byte/, attempt.input);
    assert.match(attempt.result, /did not raise/, attempt.input);
  }
});

/* ------------------------------------------------------------------------- *
 * The gate withdrawal
 * ------------------------------------------------------------------------- */

test("the gate measurement records zero true positives, which is the corrected result", () => {
  assert.equal(GATE_MEASUREMENT.truePositives, 0);
  assert.equal(GATE_MEASUREMENT.trueNegatives, 8);
  // Every payload captured for this project qualifies once it is decoded, so the eight are all
  // negatives and there is nothing left over for a gate to have caught.
  assert.equal(GATE_MEASUREMENT.truePositives + GATE_MEASUREMENT.trueNegatives, 8);
});

test("the retracted figure appears only as the retracted claim, never as a standing one", () => {
  // `withdrawnClaim` is the only place "4 of 4" may appear, and it has to be reachable, because a
  // retraction that deletes the claim leaves the reader unable to tell what was corrected.
  assert.match(GATE_MEASUREMENT.withdrawnClaim, /4 of 4/);
  assert.match(GATE_MEASUREMENT.standing, /no measured true positive/);
  assert.ok(!/4 of 4/.test(GATE_MEASUREMENT.standing));
  assert.ok(!/4 of 4/.test(GATE_MEASUREMENT.cause));
  assert.ok(!/4 of 4/.test(GATE_MEASUREMENT.tell));
  // And nowhere else in the module, in either spelling.
  assert.equal(MODULE_SOURCE.split("4 of 4").length - 1, 1);
  assert.ok(!MODULE_SOURCE.includes("4/4"));
});

test("the cause names the specific mistake, so the retraction is checkable rather than an apology", () => {
  assert.match(GATE_MEASUREMENT.cause, /skipped decompression/);
  assert.match(GATE_MEASUREMENT.cause, /flip to QUALIFIED on decompression alone/);
  // The tell is what makes the whole thing generalisable: zero sections is what compressed bytes
  // score, and a genuinely deficient page scores low rather than zero.
  assert.match(GATE_MEASUREMENT.tell, /zero of N sections/);
  assert.match(GATE_MEASUREMENT.tell, /deficient page scores low/);
});

test("the gates are described as fail-closed rather than as tested, in the standing sentence", () => {
  assert.match(GATE_MEASUREMENT.standing, /fail-closed/);
  assert.match(GATE_MEASUREMENT.standing, /Gates B, C and D/);
  // The claim is weaker than "these catch bad captures" and is stated as the weaker one.
  assert.ok(!/caught/.test(GATE_MEASUREMENT.standing));
});

/* ------------------------------------------------------------------------- *
 * The one synthetic capture
 * ------------------------------------------------------------------------- */

test("the only evidence that the three gates differ is labelled synthetic wherever it stands", () => {
  assert.match(SYNTHETIC_NEGATIVE.standing, /^Synthetic\./);
  assert.match(SYNTHETIC_NEGATIVE.standing, /not a real page that failed/);
  // It is a real gzip payload with the body stripped, so the magic bytes are the real ones, and the
  // decoded length is re-derived from the file rather than restated.
  assert.equal(SYNTHETIC_NEGATIVE.magic, "1f8b");
  assert.equal(measure(SYNTHETIC_NEGATIVE.file).decoded, SYNTHETIC_NEGATIVE.decodedBytes);
  assert.equal(SYNTHETIC_NEGATIVE.decodedBytes, 35640);
});

test("the synthetic capture's two character counts are the ones the manifest recorded", () => {
  // 569 characters of chrome against 48,934 in the page it was cut from. Read from the manifest so
  // the module cannot drift from the measurement that produced the fixture.
  const expect = ROUTES.get("snap-github-tos-chrome-only").expect;
  assert.equal(SYNTHETIC_NEGATIVE.visibleChars, expect.visible_text_chars);
  assert.equal(SYNTHETIC_NEGATIVE.sourceVisibleChars, expect.source_visible_text_chars);
  assert.ok(SYNTHETIC_NEGATIVE.visibleChars < SYNTHETIC_NEGATIVE.sourceVisibleChars / 50);
});

test("the synthetic result shows the three gates disagreeing, which is the point of it", () => {
  // If all three failed together it would be evidence that they are three spellings of one test.
  // B passing while C and D refuse is the only measurement in the project that separates them.
  assert.match(SYNTHETIC_NEGATIVE.result, /Gate B passes/);
  assert.match(SYNTHETIC_NEGATIVE.result, /Gate C scores 0 of 4/);
  assert.match(SYNTHETIC_NEGATIVE.result, /Gate D fails/);
  // And the manifest agrees, per gate, from the run that produced the fixture.
  const expect = ROUTES.get("snap-github-tos-chrome-only").expect;
  assert.equal(expect.gate_b, "PASS");
  assert.equal(expect.gate_c, "FAIL");
  assert.equal(expect.gate_d, "FAIL");
});

/* ------------------------------------------------------------------------- *
 * Gate A, the one gate decision with a measurement behind it
 * ------------------------------------------------------------------------- */

test("gate A is off because of a false positive, and the two figures are the measured ones", () => {
  assert.equal(GATE_A_EVIDENCE.fromChars, 2738);
  assert.equal(GATE_A_EVIDENCE.toChars, 35689);
  assert.equal(GATE_A_EVIDENCE.policyChange, false);
  // A factor of thirteen, from navigation chrome, on a page whose terms did not move. A ratio gate
  // would have blanked a faithful capture.
  const ratio = GATE_A_EVIDENCE.toChars / GATE_A_EVIDENCE.fromChars;
  assert.ok(ratio > 12 && ratio < 14, `${ratio.toFixed(2)}x`);
  assert.match(GATE_A_EVIDENCE.conclusion, /ships disabled/);
  assert.match(GATE_A_EVIDENCE.conclusion, /publishes that it is disabled/);
});

test("gate A's inflated half is the capture the table also lists, and the manifest agrees on it", () => {
  // The 35,689 in gate A's evidence and the 35,689 in the table's undecoded column are the same
  // measurement of the same file, which is why the two may be equal. Asserted so that a later edit
  // to one of them has to confront the other.
  const oversize = GZIP_EVIDENCE.find((row) => row.fixture === "snap-gcp-deprecation-oversize.bin");
  assert.equal(oversize.page, GATE_A_EVIDENCE.page);
  assert.equal(Number(oversize.undecodedChars), GATE_A_EVIDENCE.toChars);
  assert.equal(ROUTES.get("snap-gcp-deprecation-oversize").expect.visible_text_chars, GATE_A_EVIDENCE.toChars);
});

/* ------------------------------------------------------------------------- *
 * The four citations, read out of the contract
 * ------------------------------------------------------------------------- */

test("every contract line this module cites still says what the module says it says", () => {
  // `verify-citations.mjs` only checks that a cited line exists and is not blank, so it passes a
  // silently wrong number. These are the ones that carry an argument, so they are read.
  assert.match(contractLine(810), /_GZIP_WBITS = 16 \+ zlib\.MAX_WBITS/);
  assert.match(contractLine(812), /There is deliberately no -zlib\.MAX_WBITS constant here/);
  assert.match(contractLine(847), /^def decode_payload\(raw\):/);
  assert.match(contractLine(854), /THERE IS NO RAW DEFLATE BRANCH/);
  assert.match(contractLine(1153), /GATE_A_ENABLED_DEFAULT = False/);
});

test("the citations in the module's prose are the lines above and no others", () => {
  // A citation added without a check here would be unread, which is how the earlier fifteen line
  // drift went unnoticed: every number resolved to a non-blank line.
  const cited = [...MODULE_SOURCE.matchAll(/Holdfast\.py:(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual([...new Set(cited)].sort((a, b) => a - b), [810, 812, 847, 854, 1153]);
});

test("gate A's default in the contract is the disabled one the module reports", () => {
  // The two have to agree in both directions: the module says gate A ships off, and the contract's
  // constant is what actually decides. A contract that enabled it would make the method page wrong
  // about which gates decided a capture.
  assert.ok(contractLine(1153).includes("False"));
  assert.ok(!contractLine(1153).includes("True"));
});
