/**
 * The formatters, and the two of them that are mirrors of contract code rather than decoration.
 *
 * `normalizeCommitment` and `deriveAnchor` are copies of `normalize_text` and `_derive_anchor`. If
 * either drifts, the create form shows a promisor a preview of a string the chain never stored, or
 * tells them a URL is bondable when gate B's anchor cannot be derived from it. Those two get the
 * awkward cases; the rest get enough to pin their contracts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween,
  deriveAnchor,
  displayDay,
  displayTime,
  formatBytes,
  formatCount,
  formatGen,
  frameDay,
  frameMoment,
  frameTick,
  genToWei,
  hoursBetween,
  isArchiveTimestamp,
  normalizeCommitment,
  normalizeText,
  percentOfWei,
  pluralFrames,
  shortDigest,
  shortenHex,
  timestampToDate,
} from "../src/lib/format.ts";

test("formatGen prints whole GEN without a decimal point", () => {
  assert.equal(formatGen("250000000000000000000"), "250 GEN");
  assert.equal(formatGen(0n), "0 GEN");
  assert.equal(formatGen(""), "0 GEN");
});

test("formatGen prints a fraction exactly and trims only trailing zeros", () => {
  assert.equal(formatGen("1500000000000000000"), "1.5 GEN");
  assert.equal(formatGen("1000000000000000001"), "1.000000000000000001 GEN");
});

test("formatGen refuses to invent a number out of a non-numeric string", () => {
  assert.equal(formatGen("not a number"), "not a number wei");
});

test("genToWei is exact and rejects anything that is not a plain decimal", () => {
  assert.equal(genToWei("1"), 10n ** 18n);
  assert.equal(genToWei("0.000000000000000001"), 1n);
  assert.equal(genToWei(" 2.5 "), 2500000000000000000n);
  assert.throws(() => genToWei("1e18"));
  assert.throws(() => genToWei("-1"));
  assert.throws(() => genToWei("0.0000000000000000001"));
  assert.throws(() => genToWei(""));
});

test("percentOfWei is integer arithmetic and floors rather than rounding up", () => {
  assert.equal(percentOfWei("1000", 10), "100");
  assert.equal(percentOfWei("9", 10), "0");
  assert.equal(percentOfWei("", 10), "0");
  assert.equal(percentOfWei("nonsense", 10), "0");
});

test("formatCount groups digits and returns anything else untouched", () => {
  assert.equal(formatCount("1056588"), "1,056,588");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount("372058"), "372,058");
  assert.equal(formatCount("n/a"), "n/a");
});

test("formatBytes attaches the unit", () => {
  assert.equal(formatBytes("72427"), "72,427 B");
  assert.equal(formatBytes("not bytes"), "not bytes");
});

test("abbreviation keeps short values whole", () => {
  assert.equal(shortenHex("0x1234"), "0x1234");
  assert.equal(shortenHex(""), "");
  assert.equal(shortenHex("0x0123456789abcdef0123456789abcdef01234567"), "0x0123…4567");
  assert.equal(shortDigest("ABCDEFGHIJ"), "ABCDEFGHIJ");
  assert.equal(shortDigest("ABCDEFGHIJK"), "ABCD…HIJK");
});

test("an archive timestamp is exactly fourteen digits", () => {
  assert.equal(isArchiveTimestamp("20260822123203"), true);
  assert.equal(isArchiveTimestamp(" 20260822123203 "), true);
  assert.equal(isArchiveTimestamp("2026082212320"), false);
  assert.equal(isArchiveTimestamp("202608221232030"), false);
  assert.equal(isArchiveTimestamp("2026-08-22"), false);
});

test("timestamp renderings return the input unchanged when it is not a capture stamp", () => {
  assert.equal(frameMoment("20260822123203"), "2026-08-22 12:32:03 UTC");
  assert.equal(frameTick("20260822123203"), "08-22");
  assert.equal(frameDay("20260822123203"), "2026-08-22");
  assert.equal(frameMoment("soon"), "soon");
  assert.equal(frameTick(""), "");
});

test("timestampToDate reads UTC and rejects an impossible stamp", () => {
  const date = timestampToDate("20260822123203");
  assert.ok(date instanceof Date);
  assert.equal(date.toISOString(), "2026-08-22T12:32:03.000Z");
  assert.equal(timestampToDate("nope"), undefined);
});

test("ISO instants print in UTC and pass through when unparseable", () => {
  assert.equal(displayTime("2026-08-25T11:00:00Z"), "2026-08-25 11:00:00 UTC");
  assert.equal(displayDay("2026-08-25T11:00:00Z"), "2026-08-25");
  assert.equal(displayTime("later"), "later");
  assert.equal(displayTime(""), "");
});

test("day and hour gaps are floored and signed, and undefined on bad input", () => {
  assert.equal(daysBetween("2026-08-01T00:00:00Z", "2026-08-08T23:00:00Z"), 7);
  assert.equal(daysBetween("2026-08-08T00:00:00Z", "2026-08-01T00:00:00Z"), -7);
  assert.equal(hoursBetween("2026-08-01T00:00:00Z", "2026-08-01T23:59:00Z"), 23);
  assert.equal(daysBetween("", "2026-08-01T00:00:00Z"), undefined);
  assert.equal(hoursBetween("2026-08-01T00:00:00Z", "whenever"), undefined);
});

test("pluralFrames says 1 frame and groups the rest", () => {
  assert.equal(pluralFrames(1), "1 frame");
  assert.equal(pluralFrames(0), "0 frames");
  assert.equal(pluralFrames(1200), "1,200 frames");
});

/* ------------------------------------------------------------------------- *
 * The two mirrors
 * ------------------------------------------------------------------------- */

test("normalizeText is the same function as normalizeCommitment, under the contract's other name", () => {
  assert.equal(normalizeText, normalizeCommitment);
});

test("normalization lowercases, collapses whitespace, strips the rest, and trims", () => {
  assert.equal(
    normalizeCommitment("  We will NOT sell your data.  "),
    "we will not sell your data",
  );
  assert.equal(normalizeCommitment("Section 4.2\tapplies"), "section 42 applies");
});

test("a stripped character between two words joins them", () => {
  // The two examples the contract's own docstring pins.
  assert.equal(normalizeCommitment("gzip/deflate"), "gzipdeflate");
  assert.equal(normalizeCommitment("co-operate"), "cooperate");
});

test("normalization is deliberately not idempotent, because the contract's order is the specification", () => {
  // Whitespace collapses in step 2, punctuation is stripped in step 3, and nothing re-collapses, so
  // a character removed from between two spaces leaves both spaces behind.
  assert.equal(normalizeCommitment("a - b"), "a  b");
  assert.equal(normalizeCommitment("30 EUR / (c) 2026"), "30 eur  c 2026");

  // A second pass finds a two-space run and collapses it, which is a DIFFERENT string. That is why
  // the contract hashes the caller's original once at creation and never normalizes defensively on
  // the way in: hashing a normalized string would not match the hash of the string itself.
  const once = normalizeCommitment("a - b");
  const twice = normalizeCommitment(once);
  assert.equal(twice, "a b");
  assert.notEqual(twice, once);
});

test("the whitespace class is Python's and not JavaScript's, which changes the output", () => {
  // Python counts the file separators U+001C to U+001F and NEL U+0085 as whitespace, so they
  // separate their neighbours. JavaScript does not count any of the five.
  assert.equal(normalizeCommitment("data\u0085sharing"), "data sharing");
  assert.equal(normalizeCommitment("data\u001csharing"), "data sharing");
  // Python does not count the byte order mark, so it is stripped and the words join.
  assert.equal(normalizeCommitment("data\ufeffsharing"), "datasharing");
});

test("normalization tolerates an empty or missing string", () => {
  assert.equal(normalizeCommitment(""), "");
  assert.equal(normalizeCommitment("!!!"), "");
});

test("deriveAnchor takes the last path segment and replaces separators", () => {
  assert.equal(deriveAnchor("https://example.com/legal/model-terms"), "model terms");
  assert.equal(deriveAnchor("https://example.com/legal/data_use"), "data use");
});

test("deriveAnchor drops a short extension only when something precedes it", () => {
  assert.equal(deriveAnchor("https://example.com/licenses/gpl-3.0.html"), "gpl 3.0");
  assert.equal(deriveAnchor("https://example.com/terms.html"), "terms");
  // Six characters is past the extension bound, so it stays.
  assert.equal(deriveAnchor("https://example.com/terms.markdo"), "terms.markdo");
});

test("deriveAnchor strips the query and walks back past trailing slashes", () => {
  assert.equal(deriveAnchor("https://example.com/legal/terms?lang=en"), "terms");
  assert.equal(deriveAnchor("https://example.com/legal/terms/"), "terms");
});

test("deriveAnchor yields nothing usable for a bare host or a bare directory, which is the unbondable case", () => {
  assert.equal(deriveAnchor("https://example.com"), "");
  assert.equal(deriveAnchor("https://example.com/"), "");
  assert.equal(deriveAnchor("https://example.com/a/"), "a");
});
