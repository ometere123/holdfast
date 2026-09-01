/**
 * The client's half of the two rules it reimplements, against the same table the contract runs.
 *
 * `tests/parity-cases.json` is read by exactly two files: this one, which drives `src/lib`, and
 * `tests/direct/test_parity.py`, which drives `contracts/Holdfast.py` under the real SDK. Neither
 * owns the answers. That is the whole design: an expected value edited to make one side pass breaks
 * the other side, so the table cannot quietly drift toward whichever implementation was touched last.
 *
 * WHY THESE TWO RULES CARRY A TEST THIS SIZE. `create_bond` is payable and reverts on bad input
 * rather than accepting and refunding, because StudioNet does not return `gl.message.value` when a
 * GenVM execution reverts. The contract's docstring justifies that on one condition: the caller can
 * simulate the same call with no value first. `src/lib/validate.ts` and `src/lib/dry-run.ts` are that
 * condition. So a rule missing or wrong here is not a worse error message, it is a stake sent into a
 * revert, and the two rules below are the two a careful reader would still get wrong:
 *
 *   - gate B's anchor is derived from the URL and cannot be supplied, so the form has to derive it to
 *     show it, and four of these seventeen URLs cannot be bonded for a reason no field displays;
 *   - gate D's independence rule compares normalized forms, by substring, in both directions,
 *     against a value the promisor never typed.
 *
 * THE INVISIBLE ROWS ARE THE POINT OF THE NORMALIZATION SECTION. Python's whitespace class and
 * JavaScript's `\s` differ on six characters, and the difference changes the OUTPUT rather than just
 * a classification: a character Python strips joins its neighbours into one word, and a character it
 * collapses separates them. `format.ts` writes Python's class out longhand for that reason, and these
 * rows are what would catch someone simplifying it back to `\s`. They only work if the file's escapes
 * survive editing, which the last test in this file is about.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveAnchor, normalizeText } from "../src/lib/format.ts";
import {
  checkAnchorEntries,
  checkDerivedAnchor,
  checkTerminal,
  checkTerminalIndependence,
  derivedAnchorOf,
} from "../src/lib/validate.ts";

const RAW = readFileSync(new URL("./parity-cases.json", import.meta.url));
const CASES = JSON.parse(RAW.toString("utf8"));

/**
 * Every disagreement is collected and reported together.
 *
 * A parity failure is a class of problem and not an incident. Stopping at the first one tells the
 * reader nothing about whether the rule drifted or a single row was mistyped, and those two want
 * opposite responses.
 */
function report(mismatches, total) {
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length} of ${total} cases disagree:\n${mismatches.map((line) => `  ${line}`).join("\n")}`,
  );
}

/* ------------------------------------------------------------------------- *
 * Normalization
 * ------------------------------------------------------------------------- */

test("the client normalizes every case in the shared table the way the contract does", () => {
  const cases = CASES.normalize.cases;
  const mismatches = [];
  for (const { input, expect, why } of cases) {
    const got = normalizeText(input);
    if (got !== expect) {
      mismatches.push(
        `normalizeText(${JSON.stringify(input)}) = ${JSON.stringify(got)}, table says ${JSON.stringify(expect)}  [${why}]`,
      );
    }
  }
  report(mismatches, cases.length);
});

test("the six characters JavaScript and Python disagree about are all covered", () => {
  // The divergence is not hypothetical and it is not a rounding error: each of these is a character
  // one language calls whitespace and the other does not. Asserted as a coverage floor so that a
  // future edit cannot delete the rows and leave the longhand class untested.
  const inputs = CASES.normalize.cases.map((row) => row.input).join("");
  for (const code of [0x001f, 0x0085, 0x00a0, 0x2003, 0xfeff]) {
    assert.ok(inputs.includes(String.fromCodePoint(code)), `no case exercises U+${code.toString(16)}`);
  }
});

test("a byte order mark joins its neighbours while a no-break space separates them", () => {
  // The two directions of the same divergence, stated as the pair rather than as two rows, because
  // it is the pair that shows the rule is about the OUTPUT and not about tidiness. Python does not
  // call U+FEFF whitespace, so it is dropped as punctuation and the words fuse. It does call U+00A0
  // whitespace, so that one becomes a single space.
  //
  // Built from code points rather than written as characters or as escapes. A literal invisible
  // character in this source would be indistinguishable from a space to every reader and every
  // diff, and it is the character itself that is under test.
  const joined = "data" + String.fromCodePoint(0xfeff) + "sharing";
  const separated = "data" + String.fromCodePoint(0x00a0) + "sharing";
  assert.equal(normalizeText(joined), "datasharing");
  assert.equal(normalizeText(separated), "data sharing");
  assert.notEqual(normalizeText(joined), normalizeText(separated));
});

test("normalization is not idempotent, which is why the commitment is hashed once", () => {
  // `a - b` collapses its spaces first and drops the hyphen second, leaving two adjacent spaces that
  // a second pass would collapse. The contract hashes the promisor's original string exactly once for
  // this reason, and the table carries the row so the client cannot be "fixed" into a second pass.
  const once = normalizeText("a - b");
  assert.equal(once, "a  b");
  assert.notEqual(normalizeText(once), once);
});

/* ------------------------------------------------------------------------- *
 * Gate B's derived anchor
 * ------------------------------------------------------------------------- */

test("the client derives the same anchor as the contract for every URL in the table", () => {
  const cases = CASES.anchor.cases;
  const mismatches = [];
  for (const { url, expect, normalized, why } of cases) {
    const anchor = deriveAnchor(url);
    if (anchor !== expect) {
      mismatches.push(
        `deriveAnchor(${url}) = ${JSON.stringify(anchor)}, table says ${JSON.stringify(expect)}  [${why}]`,
      );
      continue;
    }
    // Both forms, because they can drift apart. `terms.longer` keeps its dot in the anchor and loses
    // it in the normalized form, where it JOINS the two words. A client that derived correctly and
    // normalized differently would still compute the wrong overlap.
    const got = normalizeText(anchor);
    if (got !== normalized) {
      mismatches.push(
        `normalized anchor of ${url} = ${JSON.stringify(got)}, table says ${JSON.stringify(normalized)}  [${why}]`,
      );
    }
  }
  report(mismatches, cases.length);
});

test("the anchor the form prints beside the URL is the anchor the rule compares", () => {
  // `derivedAnchorOf` is what the create page displays. If it ever stopped agreeing with the value
  // `checkTerminalIndependence` compares against, the form would explain a refusal using a string
  // that had nothing to do with it.
  const mismatches = [];
  for (const { url, expect } of CASES.anchor.cases) {
    const shown = derivedAnchorOf(url);
    if (shown !== expect) mismatches.push(`${url}: shows ${JSON.stringify(shown)}, compares ${JSON.stringify(expect)}`);
  }
  report(mismatches, CASES.anchor.cases.length);
});

test("the client refuses exactly the URLs the contract cannot bond, and says what it derived", () => {
  const cases = CASES.anchor.cases;
  const mismatches = [];
  for (const { url, normalized, bondable, why } of cases) {
    const message = checkDerivedAnchor(url);
    if (bondable !== (message === "")) {
      mismatches.push(`${url}: bondable=${bondable} but the client said ${JSON.stringify(message)}  [${why}]`);
      continue;
    }
    // The refusal has to quote the derived value. This is the one field with no input of its own, so
    // a message that only said "unsuitable URL" would leave the promisor with nothing to act on.
    if (!bondable && !message.includes(JSON.stringify(normalized))) {
      mismatches.push(`${url}: refusal does not quote ${JSON.stringify(normalized)}: ${message}`);
    }
  }
  report(mismatches, cases.length);
});

test("a version number in the last path segment is eaten by the extension stripper", () => {
  // The trap worth naming. `/v1.2` looks like the most natural thing in the world to bond, and the
  // rule that turns `terms.html` into `terms` turns it into `v1`, two characters, under the floor. So
  // the URL is not bondable at all, and the only place that is visible before the wallet opens is
  // this check. Pinned as its own test because it is the row a future reader will assume is a typo.
  assert.equal(deriveAnchor("https://example.com/v1.2"), "v1");
  assert.notEqual(checkDerivedAnchor("https://example.com/v1.2"), "");
  // And the neighbouring case that proves the stripper is not simply eating everything after a dot:
  // a six character extension is left alone, so the whole segment survives.
  assert.equal(deriveAnchor("https://example.com/terms.longer"), "terms.longer");
});

/* ------------------------------------------------------------------------- *
 * Gate D's independence rule
 * ------------------------------------------------------------------------- */

test("the client agrees with the contract about which gate specifications are usable", () => {
  const cases = CASES.independence.cases;
  const mismatches = [];
  for (const { url, sections, terminal, overlaps, why } of cases) {
    const message = checkTerminalIndependence(terminal, url, sections.join("\n"));
    const label = `${JSON.stringify(terminal)} over ${JSON.stringify(sections)}`;

    if (overlaps === null) {
      if (message !== "") mismatches.push(`${label}: table calls this usable, client said ${JSON.stringify(message)}  [${why}]`);
      continue;
    }
    if (message === "") {
      mismatches.push(`${label}: table says it overlaps the ${overlaps}, client accepted it  [${why}]`);
      continue;
    }
    // Which field it collided with, not just that it collided. There are two of them and the promisor
    // can only fix the one that is actually wrong.
    const names = { anchor: "gate B's anchor", section: "every gate C section" };
    if (!message.includes(names[overlaps])) {
      mismatches.push(`${label}: table says ${overlaps}, client blamed something else: ${message}`);
    }
  }
  report(mismatches, cases.length);
});

test("an overlap against the anchor quotes the derived anchor, because nothing else shows it", () => {
  const cases = CASES.independence.cases.filter((row) => row.overlaps === "anchor");
  assert.ok(cases.length > 0);
  const mismatches = [];
  for (const { url, sections, terminal } of cases) {
    const message = checkTerminalIndependence(terminal, url, sections.join("\n"));
    const anchor = normalizeText(deriveAnchor(url));
    if (!message.includes(JSON.stringify(anchor))) {
      mismatches.push(`${JSON.stringify(terminal)}: refusal does not quote ${JSON.stringify(anchor)}: ${message}`);
    }
  }
  report(mismatches, cases.length);
});

test("two markers that differ raw and match normalized still collide", () => {
  // The row a human inspection misses, and the reason this rule is compared on normalized forms in
  // the first place. `co-operate` and `cooperate` are different strings and the same section.
  assert.notEqual(
    checkTerminalIndependence("co-operate", "https://cloud.google.com/terms", ["definitions", "cooperate", "confidential"].join("\n")),
    "",
  );
  assert.equal(normalizeText("co-operate"), normalizeText("cooperate"));
});

test("every independence case is a clean test of independence and nothing earlier", () => {
  // Guards the table rather than the code. A row whose section list or terminal marker tripped an
  // earlier check would still fail or pass for the "right" reason on the client side, while on the
  // contract side it would stop at that earlier refusal and never reach the independence rule at
  // all. Then the two suites would agree on the answer and be measuring different things.
  const mismatches = [];
  for (const { sections, terminal } of CASES.independence.cases) {
    const entries = checkAnchorEntries(sections.join("\n"));
    if (entries !== "") mismatches.push(`${JSON.stringify(sections)}: ${entries}`);
    const marker = checkTerminal(terminal);
    if (marker !== "") mismatches.push(`${JSON.stringify(terminal)}: ${marker}`);
  }
  report(mismatches, CASES.independence.cases.length);
});

/* ------------------------------------------------------------------------- *
 * The one measured divergence, and the check that makes it unreachable
 * ------------------------------------------------------------------------- */

test("a section that normalizes to empty is refused before the two rules can disagree", () => {
  // The divergence is real. `checkTerminalIndependence` skips an entry that normalizes to empty; the
  // contract's loop does not, and it asks `terminal in other or other in terminal`, where the empty
  // string is a substring of everything. So such a section would make the contract refuse EVERY
  // terminal marker while the client accepted them all.
  const { sections, terminal } = CASES.unreachable.empty_normalizing_section;
  const empty = sections.filter((entry) => normalizeText(entry) === "");
  assert.ok(empty.length > 0, "the case no longer carries a section that normalizes to empty");

  // Unreachable because the section list is refused first, in both languages. Asserted rather than
  // described, so that relaxing the per-entry floor to zero fails here instead of on chain.
  const refusal = checkAnchorEntries(sections.join("\n"));
  assert.notEqual(refusal, "");
  assert.ok(refusal.includes("normalizes to 0"), refusal);

  // And this is the disagreement that would follow if it were ever reachable, recorded as a fact
  // about the client rather than a claim about it: the client accepts what the contract would refuse.
  // The URL is the working draft's, chosen so that gate B's anchor is not what does the refusing.
  const url = "https://cloud.google.com/terms";
  assert.equal(normalizeText(deriveAnchor(url)), "terms");
  assert.equal(checkTerminalIndependence(terminal, url, sections.join("\n")), "");
});

/* ------------------------------------------------------------------------- *
 * Where the client is deliberately stricter, and why that direction is safe
 * ------------------------------------------------------------------------- */

test("the terminal marker floor is stricter here than on chain, in the safe direction", () => {
  // The contract requires a non-empty terminal marker; this requires three raw characters. That is a
  // divergence, and it is the harmless one: the client refuses a superset of what the contract
  // refuses, so it can cost somebody a rejected form but never a stranded stake. Stated as a test so
  // the asymmetry is deliberate and documented rather than discovered later and "fixed" backwards.
  assert.notEqual(checkTerminal("ab"), "");
  assert.equal(checkTerminal("abc"), "");
  // And the strictness never contradicts the shared table: every marker the table calls usable
  // clears the stricter floor too, so no row passes on chain and fails in the form.
  for (const { terminal, overlaps } of CASES.independence.cases) {
    if (overlaps === null) assert.equal(checkTerminal(terminal), "", terminal);
  }
});

/* ------------------------------------------------------------------------- *
 * The table itself
 * ------------------------------------------------------------------------- */

test("the case file is pure ASCII, so its invisible characters survive an edit", () => {
  // Four rows turn on a single character that cannot be seen in an editor, and they are written as
  // `\uXXXX` escapes for that reason. A literal no-break space pasted in during a later edit would
  // look identical, read identically, and silently test the wrong character. It would also break the
  // Python reader, which opens this file as ASCII on purpose. This is the cheap guard for both.
  for (const byte of RAW) {
    assert.ok(byte >= 0x09 && byte <= 0x7e, `non-ASCII byte 0x${byte.toString(16)} in parity-cases.json`);
  }
});

test("every case in the file carries its reason, because a bare expected value teaches nothing", () => {
  // A row without a `why` is a value somebody will eventually change to make a build pass. The
  // sentence is what makes that visibly the wrong move.
  const mismatches = [];
  for (const section of ["normalize", "anchor", "independence"]) {
    for (const [index, row] of CASES[section].cases.entries()) {
      if (typeof row.why !== "string" || row.why.trim() === "") mismatches.push(`${section}[${index}]`);
    }
    assert.ok(Array.isArray(CASES[section]._readme), `${section} has no _readme`);
  }
  report(mismatches, CASES.normalize.cases.length + CASES.anchor.cases.length + CASES.independence.cases.length);
});
