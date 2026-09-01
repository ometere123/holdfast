/**
 * The four frame kinds, and the one distinction the whole product rests on.
 *
 * An unchanged frame is a fact about bytes: retrieved, digest matched the published index, decoded,
 * through every enabled gate, and hashing to the baseline. A blank frame is the absence of a fact:
 * the bytes arrived and verified, and the decoded document was refused as evidence. The failure this
 * separation defends against is a gzip replay that extracts to almost no text and therefore reads as
 * every clause deleted, unanimously, by every validator at once. Four real terms pages produced
 * exactly that reading.
 *
 * So the tests below are mostly about what must NOT happen: a blank frame must never be collapsed,
 * must never be counted as admitted, must never carry a reading, and must never borrow an unchanged
 * frame's caption.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baselineOf,
  frameKind,
  gatePhrase,
  isAdmitted,
  lightTableFrame,
  neverCollapsed,
  readingUnaccounted,
  stripSegments,
  tally,
  tallySentence,
  toFrames,
} from "../src/lib/frames.ts";

const BASELINE = { digest: "BASEDIGEST00000000000000000000AA", timestamp: "20260101000000" };

/** One change point, with only the fields a test cares about spelled out at the call site. */
function point(overrides = {}) {
  return {
    bond_id: "b1",
    timestamp: "20260201000000",
    digest: BASELINE.digest,
    raw_len: "72427",
    encoding: "gzip",
    decoded_sha256: "0".repeat(64),
    text_len: "12040",
    text_truncated: false,
    qualified: true,
    failed_gates: "",
    gate_c_hits: "4",
    classification: "HOLDS",
    excerpt: "",
    rationale: "",
    observed_at: "2026-02-01T00:05:00Z",
    ...overrides,
  };
}

/** A rejected point: admitted is false and the gates say which ones refused it. */
function blank(overrides = {}) {
  return point({
    qualified: false,
    failed_gates: "C,D",
    classification: "",
    gate_c_hits: "0",
    ...overrides,
  });
}

/* ------------------------------------------------------------------------- *
 * Admission and kind
 * ------------------------------------------------------------------------- */

test("baselineOf pairs the two bond fields so they cannot be passed the wrong way round", () => {
  const bond = { baseline_digest: "D", baseline_timestamp: "T" };
  assert.deepEqual(baselineOf(bond), { digest: "D", timestamp: "T" });
});

test("admission is exactly the qualified flag, which is the only field a payout may branch on", () => {
  assert.equal(isAdmitted(point({ qualified: true })), true);
  assert.equal(isAdmitted(point({ qualified: false })), false);
  // Not admitted stays not admitted even with a reading attached, which the contract cannot
  // produce. Falling back to the reading here would resurrect a refused capture as evidence.
  assert.equal(isAdmitted(blank({ classification: "ABSENT" })), false);
});

test("the four kinds are decided in order: blank, then baseline, then unchanged, then differs", () => {
  assert.equal(frameKind(blank(), BASELINE), "blank");
  assert.equal(frameKind(point({ timestamp: BASELINE.timestamp }), BASELINE), "baseline");
  assert.equal(frameKind(point({ digest: BASELINE.digest }), BASELINE), "unchanged");
  assert.equal(frameKind(point({ digest: "SOMETHINGELSE" }), BASELINE), "differs");
});

test("the baseline capture is blank if it was refused, because the timestamp does not admit it", () => {
  // Blank is tested first on purpose. A refused capture that happens to sit at the baseline
  // timestamp is still a capture nothing was read from.
  assert.equal(frameKind(blank({ timestamp: BASELINE.timestamp }), BASELINE), "blank");
});

/* ------------------------------------------------------------------------- *
 * Gate phrasing
 * ------------------------------------------------------------------------- */

test("a caption names the gates that decided, in singular, plural and empty forms", () => {
  assert.equal(gatePhrase("B"), "gate B failed");
  assert.equal(gatePhrase("B,D"), "gates B and D failed");
  assert.equal(gatePhrase("B,C,D"), "gates B, C and D failed");
  assert.equal(gatePhrase(""), "not admitted");
  // Whitespace and stray separators are tolerated, because the field is a joined string on chain.
  assert.equal(gatePhrase(" B , D "), "gates B and D failed");
  assert.equal(gatePhrase(",,"), "not admitted");
});

/* ------------------------------------------------------------------------- *
 * Derived frames
 * ------------------------------------------------------------------------- */

test("a blank frame carries no reading and no finding, whatever the point says", () => {
  const [frame] = toFrames([blank({ classification: "ABSENT" })], BASELINE);
  assert.equal(frame.kind, "blank");
  assert.equal(frame.reading, "");
  assert.equal(frame.finding, false);
  assert.equal(frame.unaccounted, false);
  assert.equal(frame.failedGates, "C,D");
  assert.equal(frame.caption, "gates C and D failed");
});

test("a finding is a differing frame read as weaker or gone, and nothing else is", () => {
  const kinds = [
    ["WEAKENED", true],
    ["ABSENT", true],
    ["HOLDS", false],
    ["INDETERMINATE", false],
  ];
  for (const [classification, expected] of kinds) {
    const [frame] = toFrames([point({ digest: "OTHER", classification })], BASELINE);
    assert.equal(frame.kind, "differs");
    assert.equal(frame.finding, expected, classification);
  }
  // An unchanged digest is not a finding even if the reading somehow says otherwise: the bytes are
  // identical to the baseline, so there is nothing to have weakened.
  const [unchanged] = toFrames([point({ classification: "WEAKENED" })], BASELINE);
  assert.equal(unchanged.kind, "unchanged");
  assert.equal(unchanged.finding, false);
});

test("each caption says both what the bytes did and what was read, and none is empty", () => {
  const captions = toFrames(
    [
      point({ timestamp: BASELINE.timestamp }),
      point(),
      point({ digest: "OTHER", classification: "WEAKENED" }),
      point({ digest: "OTHER", classification: "ABSENT" }),
      point({ digest: "OTHER", classification: "INDETERMINATE" }),
      point({ digest: "OTHER", classification: "HOLDS" }),
      blank({ failed_gates: "B" }),
    ],
    BASELINE,
  ).map((frame) => frame.caption);
  assert.deepEqual(captions, [
    "baseline",
    "digest unchanged",
    "digest differs, commitment narrower",
    "digest differs, commitment not present",
    "digest differs, reading unresolved",
    "digest differs, commitment holds",
    "gate B failed",
  ]);
  // A blank frame's caption is never an unchanged frame's caption, at any width.
  assert.notEqual(captions[6], captions[1]);
});

test("frames are indexed in the order the history returned them and carry their own tick", () => {
  const frames = toFrames([point({ timestamp: "20260201000000" }), point({ timestamp: "20260315120000" })], BASELINE);
  assert.deepEqual(frames.map((frame) => frame.index), [0, 1]);
  assert.deepEqual(frames.map((frame) => frame.tick), ["02-01", "03-15"]);
});

/* ------------------------------------------------------------------------- *
 * The guard for a shape the contract cannot produce
 * ------------------------------------------------------------------------- */

test("an admitted point with no reading is reported as unaccounted rather than drawn as clean", () => {
  // `_classification_of` raises [LLM_ERROR] on an answer outside the four words, so this shape
  // cannot come off the deployed contract. If it ever did, falling through to "digest differs"
  // would present a capture nothing was concluded about as reassurance.
  assert.equal(readingUnaccounted(point({ classification: "" })), true);
  assert.equal(readingUnaccounted(blank({ classification: "" })), false);
  assert.equal(readingUnaccounted(point({ classification: "HOLDS" })), false);

  const [frame] = toFrames([point({ digest: "OTHER", classification: "" })], BASELINE);
  assert.equal(frame.unaccounted, true);
  assert.equal(frame.caption, "digest differs, no reading recorded");
});

/* ------------------------------------------------------------------------- *
 * Collapse
 * ------------------------------------------------------------------------- */

test("only unchanged frames collapse, and never fewer than two of them", () => {
  const frames = toFrames(
    [
      point({ timestamp: BASELINE.timestamp }),
      point({ timestamp: "20260202000000" }),
      point({ timestamp: "20260203000000" }),
      point({ timestamp: "20260204000000" }),
      point({ timestamp: "20260205000000", digest: "OTHER", classification: "WEAKENED" }),
    ],
    BASELINE,
  );
  const segments = stripSegments(frames);
  assert.deepEqual(segments.map((segment) => segment.kind), ["single", "run", "single"]);
  assert.equal(segments[1].count, 3);
  assert.equal(segments[1].from, "20260202000000");
  assert.equal(segments[1].to, "20260204000000");
  assert.equal(segments[1].label, "3 frames · digest unchanged");
  // The run keeps its frames, so opening it is possible. A summary is only honest while reversible.
  assert.equal(segments[1].frames.length, 3);
});

test("a lone unchanged frame stays a single, so it keeps its own timestamp on the axis", () => {
  const frames = toFrames(
    [point({ timestamp: "20260202000000" }), point({ timestamp: "20260203000000", digest: "OTHER" })],
    BASELINE,
  );
  assert.deepEqual(stripSegments(frames).map((segment) => segment.kind), ["single", "single"]);
});

test("a blank frame is never swallowed by the band beside it, which is the load bearing rule", () => {
  const frames = toFrames(
    [
      point({ timestamp: "20260202000000" }),
      point({ timestamp: "20260203000000" }),
      blank({ timestamp: "20260204000000" }),
      point({ timestamp: "20260205000000" }),
      point({ timestamp: "20260206000000" }),
    ],
    BASELINE,
  );
  const segments = stripSegments(frames);
  // The blank breaks the run in two rather than being absorbed into either of them.
  assert.deepEqual(segments.map((segment) => segment.kind), ["run", "single", "run"]);
  assert.equal(segments[1].frame.kind, "blank");
  // And at any minRun, including one that would collapse everything else.
  for (const minRun of [1, 2, 3]) {
    const drawn = stripSegments(frames, minRun);
    const blanks = drawn.filter((segment) => segment.kind === "single" && segment.frame.kind === "blank");
    assert.equal(blanks.length, 1, `minRun ${minRun}`);
  }
});

test("neverCollapsed is every frame a narrow screen must still draw individually", () => {
  const frames = toFrames(
    [
      point({ timestamp: BASELINE.timestamp }),
      point({ timestamp: "20260202000000" }),
      blank({ timestamp: "20260203000000" }),
      point({ timestamp: "20260204000000", digest: "OTHER", classification: "ABSENT" }),
    ],
    BASELINE,
  );
  assert.deepEqual(neverCollapsed(frames).map((frame) => frame.kind), ["baseline", "blank", "differs"]);
});

test("an empty history collapses to nothing rather than to a run of nothing", () => {
  assert.deepEqual(stripSegments([]), []);
  assert.deepEqual(toFrames([], BASELINE), []);
});

/* ------------------------------------------------------------------------- *
 * The tally, and the sentence under the strip
 * ------------------------------------------------------------------------- */

test("the tally counts the baseline as unchanged and keeps blank frames out of admitted", () => {
  const frames = toFrames(
    [
      point({ timestamp: BASELINE.timestamp }),
      point({ timestamp: "20260202000000" }),
      point({ timestamp: "20260203000000", digest: "OTHER", classification: "WEAKENED" }),
      blank({ timestamp: "20260204000000" }),
      point({ timestamp: "20260205000000", digest: "OTHER", classification: "" }),
    ],
    BASELINE,
  );
  const counts = tally(frames);
  assert.equal(counts.total, 5);
  assert.equal(counts.admitted, 4);
  assert.equal(counts.unchanged, 2);
  assert.equal(counts.differs, 2);
  assert.equal(counts.blank, 1);
  assert.equal(counts.findings, 1);
  assert.equal(counts.unaccounted, 1);
  // The counts partition the frames: admitted plus blank is the total, and nothing is double
  // counted into both.
  assert.equal(counts.admitted + counts.blank, counts.total);
});

test("the sentence counts blank captures out loud and separately, in singular and plural", () => {
  const one = tallySentence({ total: 2, admitted: 1, unchanged: 1, differs: 0, blank: 1, findings: 0, unaccounted: 0 });
  assert.equal(
    one,
    "1 capture was admitted, and none differed from the baseline digest. 1 further capture could not be admitted and was not read.",
  );

  const many = tallySentence({ total: 14, admitted: 11, unchanged: 9, differs: 2, blank: 3, findings: 1, unaccounted: 0 });
  assert.equal(
    many,
    "11 captures were admitted, and 2 differed from the baseline digest. 3 further captures could not be admitted and were not read.",
  );

  const clean = tallySentence({ total: 4, admitted: 4, unchanged: 3, differs: 1, blank: 0, findings: 0, unaccounted: 0 });
  assert.equal(clean, "4 captures were admitted, and 1 differed from the baseline digest.");
  // No blank clause at all when there are none, rather than a "0 further captures" clause.
  assert.ok(!clean.includes("further"));
});

test("the sentence never describes a blank capture as admitted, at any count", () => {
  for (const blankCount of [0, 1, 2, 500]) {
    const sentence = tallySentence({
      total: 3 + blankCount,
      admitted: 3,
      unchanged: 3,
      differs: 0,
      blank: blankCount,
      findings: 0,
      unaccounted: 0,
    });
    assert.match(sentence, /^3 captures were admitted/);
    if (blankCount > 0) assert.match(sentence, /could not be admitted and (was|were) not read/);
  }
});

/* ------------------------------------------------------------------------- *
 * What the light table opens on
 * ------------------------------------------------------------------------- */

test("the light table opens on the first finding, and otherwise on the last differing frame", () => {
  const withFinding = toFrames(
    [
      point({ timestamp: "20260202000000", digest: "OTHER", classification: "HOLDS" }),
      point({ timestamp: "20260203000000", digest: "OTHER", classification: "WEAKENED" }),
      point({ timestamp: "20260204000000", digest: "OTHER", classification: "ABSENT" }),
    ],
    BASELINE,
  );
  assert.equal(lightTableFrame(withFinding)?.index, 1);

  const noFinding = toFrames(
    [
      point({ timestamp: "20260202000000", digest: "OTHER", classification: "HOLDS" }),
      point({ timestamp: "20260203000000" }),
      point({ timestamp: "20260204000000", digest: "OTHER", classification: "INDETERMINATE" }),
    ],
    BASELINE,
  );
  assert.equal(lightTableFrame(noFinding)?.index, 2);
});

test("the light table opens on nothing when nothing differed, rather than on a blank frame", () => {
  const frames = toFrames(
    [point({ timestamp: BASELINE.timestamp }), point({ timestamp: "20260202000000" }), blank()],
    BASELINE,
  );
  assert.equal(lightTableFrame(frames), undefined);
  assert.equal(lightTableFrame([]), undefined);
});

test("finding the last differing frame does not reverse the caller's array", () => {
  const frames = toFrames(
    [
      point({ timestamp: "20260202000000", digest: "OTHER", classification: "HOLDS" }),
      point({ timestamp: "20260203000000", digest: "OTHER", classification: "HOLDS" }),
    ],
    BASELINE,
  );
  lightTableFrame(frames);
  assert.deepEqual(frames.map((frame) => frame.index), [0, 1]);
});
