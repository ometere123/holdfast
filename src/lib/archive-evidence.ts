/**
 * Measurements, not fixtures.
 *
 * Every other named page in this codebase is an RFC 2606 example domain, because inventing a
 * promise and attributing it to a real company is the exact failure this product exists to prevent.
 * The pages named in this file are named for the opposite reason: nothing here is a promise anybody
 * made. These are byte counts taken off real Wayback replays while the decoding path was being
 * built, and they are the reason that path exists.
 *
 * This module is separate from `mock-data.ts` so the method page can cite a measurement without
 * importing a single invented bond. Nothing here is bonded anywhere in this app.
 *
 * HOW THE COUNTS RECONCILE. `_build/fixtures/holdfast/` holds eight captured payloads. Seven are
 * real replays and are enumerated in `GZIP_EVIDENCE` below; the eighth was built by hand and is
 * held separately in `SYNTHETIC_NEGATIVE` so it can never be counted as evidence about a real page.
 * Six of the eight begin `1f8b` (five real, one synthetic) and two begin `3c21` (both real).
 *
 * EVERY ROW NAMES ITS ARTEFACT. The `fixture` field is the file the row was measured from, and
 * `tests/archive-evidence.test.mjs` reads each of those files and re-derives `raw`, `decoded` and
 * `encoding` from the bytes. That is deliberate and it is a correction: see `TABLE_CORRECTION`.
 *
 * ONE FILENAME CONTAINS A WITHDRAWN WORD, AND IT IS LEFT THERE. `snap-gcp-deprecation-incomplete.bin`
 * was captured under the belief that it was a truncated gzip member. It is not: it decodes cleanly to
 * 696,794 bytes, which is recorded in the fixture manifest as `renamed_from`. The manifest route was
 * renamed to `snap-gcp-deprecation-gzip`; the file on disk was not, because five build scripts read
 * it by name and because the stale filename is a fossil of the same mistake this module keeps two
 * retractions for. The mismatch is asserted in the tests rather than left to be noticed.
 */

/**
 * What the Wayback `id_` replay actually returns, for all seven real captures.
 *
 * `undecodedChars` is the size of the document a build that skipped decompression would have had to
 * work from, measured the way this project measures visible text everywhere: the length of
 * `extract_text` output, before normalisation, which is the same measure the fixture manifest
 * records as `visible_text_chars`.
 *
 * IT IS NOT ZERO, AND THAT IS THE FINDING. Compressed bytes put through a `utf-8, replace` decode
 * yield tens of thousands of characters. A build that skipped decompression would not fail an
 * emptiness check, a length check, or a "did we get a document" check. It would pass all three and
 * then read the document as saying nothing, which is what `sectionsUndecoded` records: not one of
 * the declared sections is present in any of the five compressed captures. The zero that carries
 * the argument is that one, not a character count.
 *
 * The two `identity` rows are the control, and they are the same page as a compressed row rather
 * than a different site: `openai.com/policies/terms-of-use` was archived uncompressed in 2024 and
 * compressed in 2026. Raw equals decoded on both, and the characters extracted without decoding are
 * the document itself, so the identity branch is measured rather than theoretical.
 */
export const GZIP_EVIDENCE: Array<{
  fixture: string;
  page: string;
  timestamp: string;
  raw: string;
  decoded: string;
  encoding: string;
  undecodedChars: string;
  sectionsUndecoded: string;
}> = [
  {
    fixture: "snap-gcp-deprecation-incomplete.bin",
    page: "cloud.google.com/terms/deprecation",
    timestamp: "20231208083742",
    raw: "61023",
    decoded: "696794",
    encoding: "gzip",
    undecodedChars: "28008",
    sectionsUndecoded: "no sections declared",
  },
  {
    fixture: "snap-openai-tou-identity.bin",
    page: "openai.com/policies/terms-of-use",
    timestamp: "20240530181101",
    raw: "178326",
    decoded: "178326",
    encoding: "identity",
    undecodedChars: "21241",
    sectionsUndecoded: "nothing compressed",
  },
  {
    fixture: "snap-gcp-terms-gzip.bin",
    page: "cloud.google.com/terms",
    timestamp: "20260129024608",
    raw: "89652",
    decoded: "819751",
    encoding: "gzip",
    undecodedChars: "38619",
    sectionsUndecoded: "0 of 3",
  },
  {
    fixture: "snap-gcp-deprecation-oversize.bin",
    page: "cloud.google.com/terms/deprecation",
    timestamp: "20260316010536",
    raw: "2044592",
    decoded: "2044592",
    encoding: "identity",
    undecodedChars: "35689",
    sectionsUndecoded: "nothing compressed",
  },
  {
    fixture: "snap-aws-terms-gzip.bin",
    page: "aws.amazon.com/service-terms",
    timestamp: "20260815145826",
    raw: "215912",
    decoded: "1056588",
    encoding: "gzip",
    undecodedChars: "99106",
    sectionsUndecoded: "0 of 3",
  },
  {
    fixture: "snap-github-tos-gzip.bin",
    page: "docs.github.com/en/site-policy/github-terms/github-terms-of-service",
    timestamp: "20260822123203",
    raw: "72427",
    decoded: "372058",
    encoding: "gzip",
    undecodedChars: "33632",
    sectionsUndecoded: "0 of 4",
  },
  {
    fixture: "snap-openai-tou-gzip.bin",
    page: "openai.com/policies/terms-of-use",
    timestamp: "20260822225356",
    raw: "51163",
    decoded: "364722",
    encoding: "gzip",
    undecodedChars: "26684",
    sectionsUndecoded: "0 of 3",
  },
];

/**
 * The correction that produced the table above, published rather than quietly applied.
 *
 * This is the second instance in this project of one class of mistake: a number that was consistent
 * with the other numbers around it and was never tied back to the thing it described. The first was
 * the gate measurement in `GATE_MEASUREMENT`. This one is worse, because the file it was in says in
 * its own header that it holds no invented data.
 *
 * The tell is the one worth keeping. Eighteen tests passed on the old table. Every one of them
 * checked the numbers against each other: that the decoded count exceeded the raw count, that the
 * inflation ratio was plausible, that the largest value was the one named in the prose. None of them
 * opened a capture. A table of measurements whose rows have been recombined satisfies every
 * internal-consistency check that a correct table satisfies, so the only test that can detect it is
 * one that reads the artefact.
 */
export const TABLE_CORRECTION = {
  withdrawnClaim:
    "Four gzip replays, each with 0 readable characters undecoded, on github.com/site/terms, openai.com/policies/terms-of-use, aws.amazon.com/service-terms and policies.google.com/terms, plus a gnu.org GPL page as the uncompressed control.",
  cause:
    "The five decoded byte counts were real and correctly paired with their capture timestamps. The page names had been rotated by one position against those timestamps, so two rows named the wrong site, and four of the five raw byte counts had been copied out of mock-data.ts, which holds invented bonds. The gnu.org control was the OpenAI 2024 capture under another name.",
  tell:
    "The undecoded character counts were published as 0. They are 26,684 to 99,106. A zero there would have meant the gates refused those captures for emptiness, but the withdrawn gate measurement in the same file records them scoring zero of N sections, which is what a non-empty unreadable document scores. The two claims contradicted each other and both were tested.",
  standing:
    "Every row now names the fixture it was measured from, and the tests re-derive raw, decoded and encoding from those bytes. The character counts are extract_text lengths on the undecoded payload, and the load-bearing zero has moved to sectionsUndecoded, where it was measured.",
  testsThatPassedOnTheWrongTable: 18,
} as const;

/**
 * The three decode branches, and why there is deliberately no fourth.
 *
 * `decode_payload` at Holdfast.py:847 dispatches on the first bytes: 1f8b is gzip, a leading 78 is
 * zlib, anything else is passed through unchanged. A raw-deflate branch looks like an obvious
 * fourth case, and Holdfast.py:854 says it is absent on purpose for the measured reason recorded in
 * `NO_RAW_DEFLATE_BRANCH`. The absence is structural rather than merely intended: Holdfast.py:812
 * declines to define the negative window constant, which is the only thing a future edit would need
 * to bring the branch back.
 */
export const DECODE_BRANCHES: Array<{ magic: string; branch: string; note: string }> = [
  { magic: "1f8b", branch: "gzip", note: "Six of the eight captured payloads. Inflated with a 16 + MAX_WBITS window, Holdfast.py:810." },
  { magic: "78", branch: "zlib", note: "The bare deflate wrapper. Same inflate, default window. No capture in this project arrived as one." },
  { magic: "other", branch: "identity", note: "Two of the eight, both 3c21, an uncompressed doctype. The replay is the payload." },
];

/**
 * Why the fourth branch is absent, in the form of the two shapes that were actually tried.
 *
 * A raw-deflate attempt would not raise on either of these. It would succeed and hand back a
 * plausible near-empty document, and every validator would agree on it. A branch that cannot fail
 * loudly is worse than a missing branch that fails closed.
 */
export const NO_RAW_DEFLATE_BRANCH: Array<{ input: string; result: string }> = [
  {
    input: "a JSON object opening, then filler, 71,095 bytes",
    result: "zlib.decompress(raw, -MAX_WBITS) returned 1 byte, eof=True, and left 71,092 bytes as unused_data. It did not raise.",
  },
  {
    input: "an empty JSON array, 2 bytes",
    result: "zlib.decompress(raw, -MAX_WBITS) returned 1 byte, eof=False, 0 bytes unused. It did not raise.",
  },
];

/**
 * The withdrawn gate measurement, kept on the page rather than deleted from it.
 *
 * An earlier build of this project published the claim that gates B, C and D each caught four of
 * four known-bad snapshots. That number was an artefact of the script that produced it: the script
 * fetched the `id_` replay and never decompressed it, so four faithful gzip captures were graded as
 * binary noise. All four qualify on decompression alone.
 *
 * The tell was inside the result. "Every bad snapshot scored zero of N sections" is what compressed
 * bytes score. A page that is genuinely missing its terms scores low, not zero.
 *
 * The finding is kept because it is the strongest evidence in the project for the thing the project
 * is about: the trap caught the research script written to study the trap.
 */
export const GATE_MEASUREMENT = {
  withdrawnClaim: "Gates B, C and D each caught 4 of 4 known-bad snapshots.",
  cause:
    "The measuring script fetched the raw id_ replay and skipped decompression, so four faithful gzip captures were graded as binary. All four flip to QUALIFIED on decompression alone.",
  tell:
    "Every one of the four scored zero of N sections. Zero is what compressed bytes score. A deficient page scores low.",
  standing:
    "Gates B, C and D have no measured true positive. They are a reasoned fail-closed safeguard and are described as one, here and in the contract.",
  trueNegatives: 8,
  truePositives: 0,
} as const;

/**
 * The one synthetic capture that shows the three enabled gates doing separate work.
 *
 * Built by taking a real gzip replay and stripping everything but the page chrome. It is the only
 * evidence in the project that B, C and D are not three spellings of one test, and it is synthetic,
 * which is stated wherever it is cited.
 */
export const SYNTHETIC_NEGATIVE = {
  file: "snap-github-tos-chrome-only.bin",
  magic: "1f8b",
  decodedBytes: 35640,
  visibleChars: 569,
  sourceVisibleChars: 48934,
  result: "Gate B passes. Gate C scores 0 of 4. Gate D fails.",
  standing: "Synthetic. It demonstrates independence between the gates, not a real page that failed.",
} as const;

/**
 * Why gate A is off by default, which is the one gate decision with a measured reason behind it.
 *
 * `GATE_A_ENABLED_DEFAULT` is False at Holdfast.py:1153. A size-ratio gate would have rejected a
 * real capture that had no policy change in it at all: navigation chrome grew the extracted text of
 * one Google Cloud page more than tenfold across a period in which its terms did not move.
 */
export const GATE_A_EVIDENCE = {
  page: "cloud.google.com/terms/deprecation",
  fromChars: 2738,
  toChars: 35689,
  policyChange: false,
  conclusion:
    "Chrome inflated the extracted text by a factor of thirteen with no change to the policy. A ratio gate would have blanked a faithful capture, so gate A ships disabled and the contract publishes that it is disabled.",
} as const;
