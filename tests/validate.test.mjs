/**
 * The client mirror of the contract's deterministic refusals.
 *
 * These tests used to be load bearing in a way most validator tests are not. `create_bond` was
 * payable and refused by reverting, and StudioNet does not return `gl.message.value` when a GenVM
 * execution reverts, so a rule missing here was not a worse error message, it was a stranded stake.
 * That stopped being true when a funded transaction proved the argument insufficient and both payable
 * methods became refusal boundaries: `create_bond` now refunds and returns the tagged sentence
 * instead of raising it (`Holdfast.py:2506`).
 *
 * What these tests are worth now is smaller and still real. A rule missing here turns a typo into a
 * signed transaction that comes back refused, a refund that arrives at finality rather than
 * immediately, and a wait for an answer this file already had. So the tests stay, and the five
 * regressions they are named after stay named.
 *
 * Five rules were wrong in an earlier version of `validate.ts` and every one of the five would have
 * sent a call that came back refused. Each has a test below, named after the defect rather than after
 * the function, because the point of the test is the regression and not the coverage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNCHECKABLE_BEFORE_SIGNING,
  anchorEntries,
  anchorWordsJson,
  checkAnchorEntries,
  checkBondId,
  checkCommitment,
  checkDerivedAnchor,
  checkPayee,
  checkStake,
  checkTerminal,
  checkTerminalIndependence,
  checkTermDays,
  checkTimestamp,
  checkUrl,
  derivedAnchorOf,
  emptyDraft,
  validateContest,
  validateDraft,
} from "../src/lib/validate.ts";

const PAYEE = "0x81b6c8b2f7f0a1c3d4e5f60718293a4b5c6d7e8f";
const PROMISOR = "0x1234567890abcdef1234567890abcdef12345678";

/**
 * A draft that passes every rule, so any test below changes exactly one thing.
 *
 * The terminal marker is independent of both the derived anchor ("customer terms") and all three
 * sections, which is the rule that is easiest to violate by accident.
 */
function goodDraft(overrides = {}) {
  return {
    bondId: "acme-customer-terms-2026",
    url: "https://acme.example.com/legal/customer-terms",
    commitment: "We will not sell your personal data to any third party.",
    anchorEntries: "limitation of liability\nacceptable use\ngoverning law",
    anchorTerminal: "last revised in march of this year",
    baselineTimestamp: "20260822123203",
    payee: PAYEE,
    stake: "250",
    termDays: "365",
    ...overrides,
  };
}

const DRAFT_KEYS = Object.keys(goodDraft()).sort();

test("the reference draft is accepted, so every refusal below is about the one thing it changed", () => {
  assert.deepEqual(validateDraft(goodDraft(), PROMISOR), []);
});

test("an empty draft is refused on all nine fields, and they are exactly the nine draft fields", () => {
  const blank = {
    bondId: "",
    url: "",
    commitment: "",
    anchorEntries: "",
    anchorTerminal: "",
    baselineTimestamp: "",
    payee: "",
    stake: "",
    termDays: "",
  };
  const errors = validateDraft(blank, PROMISOR);
  assert.equal(errors.length, 9);
  assert.deepEqual(errors.map((error) => error.field).sort(), DRAFT_KEYS);
  // A field key with no message would render an error nowhere, which is worse than no check.
  for (const error of errors) assert.ok(error.message.length > 0, error.field);
});

test("every field error names a field the form actually has", () => {
  const errors = validateDraft(goodDraft({ stake: "0", termDays: "1" }), PROMISOR);
  assert.deepEqual(errors.map((error) => error.field), ["stake", "termDays"]);
});

/* ------------------------------------------------------------------------- *
 * Defect 1: the commitment was measured after trimming, and the contract measures raw
 * ------------------------------------------------------------------------- */

test("the commitment is measured untrimmed, because Holdfast.py:2112 measures untrimmed", () => {
  const exact = "a".repeat(400);
  assert.equal(checkCommitment(exact), "");
  // The same 400 characters with a pasted trailing newline is 401 to the contract.
  const over = checkCommitment(`${exact}\n`);
  assert.notEqual(over, "");
  assert.match(over, /401/);
  assert.match(over, /whitespace at either end/);
});

test("a commitment under the floor, and one that normalizes away, are refused separately", () => {
  assert.match(checkCommitment("Too short to locate."), /at least 40 characters/);
  // 40 raw characters that survive normalization as 19, one under the model's floor.
  const punctuation = "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s...";
  assert.equal(punctuation.length, 40);
  assert.match(checkCommitment(punctuation), /under the 20/);
});

/* ------------------------------------------------------------------------- *
 * Defect 2: the anchor list was split on whitespace, and entries are phrases
 * ------------------------------------------------------------------------- */

test("section markers are one per line, so a two word phrase stays one marker", () => {
  assert.deepEqual(anchorEntries("customer content\nacceptable use\n\n  governing law  "), [
    "customer content",
    "acceptable use",
    "governing law",
  ]);
  assert.equal(
    anchorWordsJson("customer content\nacceptable use\ngoverning law"),
    '["customer content","acceptable use","governing law"]',
  );
});

test("the count bounds are the contract's, and a marker is bounded per entry", () => {
  assert.match(checkAnchorEntries(""), /At least one section marker/);
  assert.match(checkAnchorEntries("one\ntwo"), /at least 3 section markers/);
  assert.equal(checkAnchorEntries(Array.from({ length: 12 }, (_, i) => `section ${i}`).join("\n")), "");
  assert.match(
    checkAnchorEntries(Array.from({ length: 13 }, (_, i) => `section ${i}`).join("\n")),
    /at most 12 section markers/,
  );
  assert.match(checkAnchorEntries(`ab\ncd\nef`), /normalizes to 2/);
  assert.match(checkAnchorEntries(`${"x".repeat(65)}\nacceptable use\ngoverning law`), /normalizes to 65/);
});

/* ------------------------------------------------------------------------- *
 * Defect 3: duplicate entries were accepted here and refused there
 * ------------------------------------------------------------------------- */

test("duplicate markers are refused after normalization, which is what the contract compares", () => {
  const message = checkAnchorEntries("Customer Content\ncustomer content\ngoverning law");
  assert.match(message, /duplicate/);
  // The colliding pair differs only in case and punctuation, so a raw comparison would miss it.
  assert.match(checkAnchorEntries("customer content\nCustomer, Content!\ngoverning law"), /duplicate/);
});

/* ------------------------------------------------------------------------- *
 * Defect 4: gate B's anchor was not checked at all, and it is derived, not supplied
 * ------------------------------------------------------------------------- */

test("gate B's anchor is derived from the URL, so a bare directory is unbondable", () => {
  assert.equal(derivedAnchorOf("https://acme.example.com/legal/customer-terms"), "customer terms");
  assert.equal(checkDerivedAnchor("https://acme.example.com/legal/customer-terms"), "");

  const bare = checkDerivedAnchor("https://acme.example.com/");
  assert.match(bare, /never supplied by the promisor/);
  assert.match(bare, /Bond the page's own address rather than a directory/);
  assert.notEqual(checkDerivedAnchor("https://acme.example.com"), "");
  // Two characters is under the floor, and the reason is printed with the derived string in it.
  assert.match(checkDerivedAnchor("https://acme.example.com/ab"), /"ab"/);
});

test("the url field reports the URL rule first and the derived anchor rule second", () => {
  // A URL that is malformed reports the malformed reason, not the anchor reason.
  const malformed = validateDraft(goodDraft({ url: "http://acme.example.com/legal/terms" }), PROMISOR);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].field, "url");
  assert.match(malformed[0].message, /must use https/);

  // A well formed URL with no usable final segment reports the anchor reason, on the same field.
  const bare = validateDraft(goodDraft({ url: "https://acme.example.com/" }), PROMISOR);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].field, "url");
  assert.match(bare[0].message, /Gate B's anchor/);
});

test("a trailing slash is not itself the problem, because the contract walks back to the last segment", () => {
  // This is the case the header docstring used to get wrong. `/legal/` derives "legal", which is a
  // usable anchor, so the draft is accepted. Only a URL with nothing usable left is refused.
  assert.equal(derivedAnchorOf("https://acme.example.com/legal/"), "legal");
  assert.deepEqual(
    validateDraft(goodDraft({ url: "https://acme.example.com/legal/" }), PROMISOR),
    [],
  );
});

/* ------------------------------------------------------------------------- *
 * Defect 5: gate D's marker was checked for length and nothing else
 * ------------------------------------------------------------------------- */

test("gate D's marker must be independent of gate B's anchor, in both directions", () => {
  const url = "https://acme.example.com/legal/customer-terms";
  // Equal to the anchor.
  assert.match(checkTerminalIndependence("Customer Terms", url, ""), /independent of gate B's anchor/);
  // A superstring of the anchor.
  assert.match(checkTerminalIndependence("acme customer terms page", url, ""), /overlaps it/);
  // A substring of the anchor: still not independent, and this is the direction that gets missed.
  assert.match(checkTerminalIndependence("terms", url, ""), /independent of gate B's anchor/);
  // The message prints the derived anchor, because the promisor cannot see it anywhere else.
  assert.match(checkTerminalIndependence("terms", url, ""), /"customer terms"/);
  assert.equal(checkTerminalIndependence("last revised in march", url, ""), "");
});

test("gate D's marker must be independent of every gate C section, in both directions", () => {
  const url = "https://acme.example.com/legal/customer-terms";
  const sections = "limitation of liability\nacceptable use\ngoverning law";
  assert.match(checkTerminalIndependence("acceptable use", url, sections), /every gate C section/);
  assert.match(checkTerminalIndependence("your acceptable use of it", url, sections), /overlaps/);
  assert.match(checkTerminalIndependence("liability", url, sections), /overlaps/);
  assert.equal(checkTerminalIndependence("last revised in march", url, sections), "");
});

test("an empty marker is the length rule's problem, not the independence rule's", () => {
  // Independence has nothing to say about a marker that is not there, so it must not claim a
  // collision with everything. The length check is what refuses the empty field.
  assert.equal(checkTerminalIndependence("", "https://acme.example.com/legal/customer-terms", "a\nb"), "");
  assert.match(checkTerminal(""), /A terminal marker is required/);
  assert.match(checkTerminal("ab"), /at least 3 characters/);
  assert.match(checkTerminal("x".repeat(121)), /more than 120 characters/);
  assert.equal(checkTerminal("last revised in march"), "");
});

test("the anchorTerminal field reports length first and independence second", () => {
  const short = validateDraft(goodDraft({ anchorTerminal: "ab" }), PROMISOR);
  assert.equal(short.length, 1);
  assert.match(short[0].message, /at least 3 characters/);

  const collides = validateDraft(goodDraft({ anchorTerminal: "customer terms" }), PROMISOR);
  assert.equal(collides.length, 1);
  assert.equal(collides[0].field, "anchorTerminal");
  assert.match(collides[0].message, /independent of gate B's anchor/);
});

/* ------------------------------------------------------------------------- *
 * The URL rules, in the order they run
 * ------------------------------------------------------------------------- */

test("a URL is https, printable ASCII, and free of fragment, credentials and port", () => {
  assert.equal(checkUrl("https://acme.example.com/legal/customer-terms"), "");
  assert.match(checkUrl(""), /A URL is required/);
  assert.match(checkUrl(`https://acme.example.com/${"a".repeat(400)}`), /at most 400 characters/);
  assert.match(checkUrl("https://acme.example.com/legal/terms#clause-4"), /Remove the fragment/);
  assert.match(checkUrl("https://user:pw@acme.example.com/legal/terms"), /Remove the credentials/);
  assert.match(checkUrl("https://acme.example.com:8443/legal/terms"), /Remove the port/);
  assert.match(checkUrl("https://localhost/legal/terms"), /dotted public name/);
  assert.match(checkUrl("not a url at all"), /must use https/);
});

test("the ASCII rule runs on the raw string and before the scheme rule, because new URL punycodes", () => {
  // `new URL` would report an ASCII hostname for this, so testing the parsed host would accept a
  // string the contract refuses. The message says why, and names the offending character.
  const idn = checkUrl("https://exámple.com/legal/terms");
  assert.match(idn, /printable ASCII/);
  assert.match(idn, /two different keys/);
  // An http URL that is also non-ASCII reports the ASCII reason, which pins the ordering.
  assert.match(checkUrl("http://exámple.com/legal/terms"), /printable ASCII/);
  // A non-breaking space pasted into the path is how this reaches a form in practice. It has to be
  // interior: JavaScript trim() strips U+00A0, so a trailing one is gone before the loop runs.
  assert.match(checkUrl("https://acme.example.com/legal/customer terms"), /printable ASCII/);
  // Surrounding whitespace is trimmed rather than reported, because the contract trims too.
  assert.equal(checkUrl("  https://acme.example.com/legal/terms  "), "");
});

/* ------------------------------------------------------------------------- *
 * The remaining fields
 * ------------------------------------------------------------------------- */

test("an id is required and bounded at 64 characters", () => {
  assert.equal(checkBondId(" acme-terms "), "");
  assert.match(checkBondId(""), /An id is required/);
  assert.equal(checkBondId("x".repeat(64)), "");
  assert.match(checkBondId("x".repeat(65)), /at most 64 characters. This one is 65/);
});

test("a baseline timestamp is exactly fourteen digits", () => {
  assert.equal(checkTimestamp(" 20260822123203 "), "");
  assert.match(checkTimestamp(""), /required/);
  assert.match(checkTimestamp("2026-08-22"), /exactly 14 digits/);
  assert.match(checkTimestamp("20260822"), /resolves to a redirect/);
});

test("the zero address cannot be the payee, and neither can the promisor", () => {
  assert.equal(checkPayee(PAYEE, PROMISOR), "");
  assert.match(checkPayee(""), /A payee is required/);
  assert.match(checkPayee("0x1234"), /not a 20 byte address/);
  assert.match(checkPayee(`0x${"00".repeat(20)}`), /burned rather than owed to anyone/);
  // Checksummed and lowercase forms of one address are one address.
  assert.match(checkPayee(PROMISOR.toUpperCase().replace("0X", "0x"), PROMISOR), /cannot be the promisor/);
  assert.match(checkPayee(PROMISOR, PROMISOR.toUpperCase().replace("0X", "0x")), /cannot be the promisor/);
  // With no promisor in hand the rule cannot be applied, and must not be guessed at.
  assert.equal(checkPayee(PROMISOR), "");
});

test("validateDraft passes the connected wallet through to the payee rule", () => {
  const errors = validateDraft(goodDraft({ payee: PROMISOR }), PROMISOR);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "payee");
  assert.match(errors[0].message, /not a promise to anyone/);
});

test("a stake is a positive amount of GEN, and the amount rule's own message is passed through", () => {
  assert.equal(checkStake(" 250 "), "");
  assert.match(checkStake(""), /A stake is required/);
  assert.match(checkStake("0"), /decorative/);
  assert.notEqual(checkStake("1e18"), "");
  assert.notEqual(checkStake("-5"), "");
  assert.notEqual(checkStake("many"), "");
});

test("a term is a whole number of days inside the contract's bounds", () => {
  assert.equal(checkTermDays("30"), "");
  assert.equal(checkTermDays("1095"), "");
  assert.match(checkTermDays("29"), /shortest term is 30 days/);
  assert.match(checkTermDays("1096"), /longest term is 1095 days/);
  assert.match(checkTermDays("30.5"), /whole number of days/);
  assert.match(checkTermDays(""), /whole number of days/);
});

test("emptyDraft seeds the term default and nothing else, because only that one is not a rule", () => {
  const draft = emptyDraft();
  assert.equal(draft.termDays, "365");
  assert.deepEqual(Object.keys(draft).sort(), DRAFT_KEYS);
  for (const [key, value] of Object.entries(draft)) {
    if (key !== "termDays") assert.equal(value, "", key);
  }
});

/* ------------------------------------------------------------------------- *
 * The contest form, and what no form can answer
 * ------------------------------------------------------------------------- */

test("the contest form holds its two fields to the same standards, under its own field names", () => {
  assert.deepEqual(validateContest("https://acme.example.com/legal/terms", "20260822123203"), []);
  const errors = validateContest("http://acme.example.com/x", "yesterday");
  assert.deepEqual(errors.map((error) => error.field), ["contestUrl", "contestTimestamp"]);
});

test("the four refusals no browser can answer are declared, and one of them is the state check", () => {
  assert.equal(UNCHECKABLE_BEFORE_SIGNING.length, 4);
  for (const line of UNCHECKABLE_BEFORE_SIGNING) assert.ok(line.length > 20, line);
  // The fourth is deterministic but needs contract state, which is what the dry run is for. If it
  // ever leaves this list, the create page stops telling the promisor the dry run is the answer.
  assert.ok(UNCHECKABLE_BEFORE_SIGNING.some((line) => line.includes("already bonded")));
});
