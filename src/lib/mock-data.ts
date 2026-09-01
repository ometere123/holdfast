/**
 * Bundled fixtures.
 *
 * These are the shapes `get_bond`, `list_bonds`, `bond_history`, `commitment_status`,
 * `get_ledger` and `get_limits` return, field for field. Nothing in `src/components` or
 * `src/app` imports this file: everything goes through `src/lib/data-source.ts`, so going live
 * is one file changing.
 *
 * Four rules were followed while writing them.
 *
 * First, no promise is attributed to a real company. Every bonded URL here is an RFC 2606
 * example domain. A fixture that put an invented sentence in a named company's mouth would be a
 * fabrication, and this product is about not fabricating readings of documents. Real pages are
 * named in exactly one module and it is not this one: `archive-evidence.ts` reports measurements
 * of real captures, bonds nothing, and lives outside the fixtures so the method page can cite a
 * measurement without importing a single invented bond.
 *
 * Second, only captures the contract could actually have recorded appear here. This is a
 * correction rather than a preference: an earlier version of this file carried blank frames for a
 * 302 replay, a 404 replay, a 429, an index timeout, a payload above the length cap, a validator
 * digest disagreement and an unusable model answer. The contract records none of those.
 * `check_commitment` calls `_raise_if_error` on the admission block and lets `_classification_of`
 * raise, so every one of them reverts the call and writes nothing at all. A gate rejection is the
 * only way a blank frame comes into existence. Six of the nine bonds changed shape because of
 * this, and the fixture set is more useful for it: the blanks that remain are all the failure the
 * product was built for, which is a capture that arrives intact and is not the document.
 *
 * Third, identical digests carry identical bytes. The digest is sha1 over the raw payload, so two
 * captures sharing one cannot disagree about `raw_len`, `encoding`, `decoded_sha256` or
 * `text_len`. The previous fixtures had twelve captures sharing a digest while their decoded
 * lengths drifted by a few hundred bytes, which would have made the frame strip's central claim
 * (equal digest means the bytes already read) visibly false to anyone who opened two frames. The
 * `Bytes` records below exist so that invariant is structural and cannot be typed wrong.
 *
 * Fourth, where a byte count sits next to another byte count, both come off the same real capture.
 * This is a correction, and it is the one that matters most in this file. An earlier version paired
 * every real `decodedLen` with an invented `rawLen`, so the inflation ratio a reader saw in the
 * frame strip was a number nobody had measured. Worse, five of those invented raw counts read as
 * measurements, and four of them were copied out of this file into `archive-evidence.ts` and
 * published on the method page as measurements of named real pages. `TABLE_CORRECTION` in that
 * module carries the retraction. The five have been replaced by the raw lengths of the captures
 * their decoded lengths came from: 72,427 to 372,058 is `snap-github-tos-gzip.bin`, 89,652 to
 * 819,751 is `snap-gcp-terms-gzip.bin`, 61,023 to 696,794 is the deprecation capture, 51,163 to
 * 364,722 is `snap-openai-tou-gzip.bin`, and 215,912 to 1,056,588 is `snap-aws-terms-gzip.bin`.
 * The chrome-only shell at 8,015 to 35,640 with 569 visible characters was already right.
 *
 * The remaining pairs in this file are constructed, and they are constructed to land inside the
 * measured inflation span. The six gzip payloads on disk run from 4.45x to 11.42x; the constructed
 * gzip pairs here run from 4.81x to 7.75x. They are not measurements and nothing outside this file
 * may cite them as any. The one other real magnitude here is the three byte `[]\n` an unarchived URL
 * returns from the index. `text_len` is derived for the same reason the constructed pairs are: the
 * contract stores characters of extracted text rather than decoded bytes, and no per-capture text
 * count was recorded during the research, so it is set at 9.5 percent of the decoded byte figure.
 * That ratio is bracketed by the two counts that were measured, the shell's 569 characters out of
 * 35,640 bytes at the bottom and the decoded GitHub terms page's 48,934 out of 372,058 at the top.
 * The shell's 569 is measured and is left alone.
 *
 * The frame coverage is deliberate. Between them these bonds exercise: a baseline, long
 * collapsible runs, a run split by a blank frame, four distinct gate rejections, an INDETERMINATE
 * reading that breaks a run without moving anything, a single uncorroborated weakening followed by
 * a reversion, two consecutive weakenings, an ABSENT pair, a bond whose every recorded capture was
 * refused, a bond one day old with only its baseline, and all five bond states.
 */

import type {
  Bond,
  BondState,
  BondSummary,
  ChangePoint,
  CommitmentReading,
  CommitmentStatus,
  EncodingKind,
  Ledger,
  Limits,
} from "./contract-types.ts";
import { deriveAnchor, normalizeCommitment } from "./format.ts";

/** The instant every relative window in these fixtures is measured against. */
export const MOCK_NOW = "2026-08-25T11:00:00Z";

/* ------------------------------------------------------------------------- *
 * Bytes
 * ------------------------------------------------------------------------- */

/**
 * One payload, named once.
 *
 * Every capture that reports this digest reports these bytes. Two captures cannot share a digest
 * and disagree about anything below, so the fields are declared together and referenced rather
 * than repeated per point.
 */
type Bytes = {
  digest: string;
  rawLen: string;
  encoding: EncodingKind;
  decodedSha: string;
  /** Decoded byte length. Not stored by the contract; kept here to derive `text_len` honestly. */
  decodedLen: number;
  /** Characters of extracted text. Derived from `decodedLen` unless a measurement exists. */
  textLen?: number;
};

/**
 * 9.5 percent of the decoded byte count.
 *
 * Bracketed by the only two text counts this project measured: the chrome-only shell's 569
 * characters out of 35,640 decoded bytes, and the decoded GitHub terms page's 48,934 out of 372,058.
 */
function textLenOf(bytes: Bytes): string {
  return String(bytes.textLen ?? Math.round(bytes.decodedLen * 0.095));
}

type Admitted = {
  bond: string;
  timestamp: string;
  bytes: Bytes;
  reading: CommitmentReading;
  excerpt?: string;
  rationale: string;
  gateCHits?: number;
  observedAt: string;
};

/** A capture that was fetched, verified, decoded and passed every enabled gate. */
function admitted(input: Admitted): ChangePoint {
  return {
    bond_id: input.bond,
    timestamp: input.timestamp,
    digest: input.bytes.digest,
    raw_len: input.bytes.rawLen,
    encoding: input.bytes.encoding,
    decoded_sha256: input.bytes.decodedSha,
    text_len: textLenOf(input.bytes),
    text_truncated: false,
    qualified: true,
    failed_gates: "",
    gate_c_hits: String(input.gateCHits ?? 4),
    classification: input.reading,
    excerpt: input.excerpt ?? "",
    rationale: input.rationale,
    observed_at: input.observedAt,
  };
}

type Refused = {
  bond: string;
  timestamp: string;
  bytes: Bytes;
  failedGates: string;
  gateCHits?: number;
  observedAt: string;
};

/**
 * A capture that arrived intact and was refused as evidence.
 *
 * `excerpt`, `rationale` and `classification` are empty because `check_commitment` passes empty
 * strings for all three on this path: the reading never runs, so there is nothing to quote and
 * nothing to explain. `encoding` is a real encoding, because the bytes had to decode before a gate
 * could measure them.
 */
function refused(input: Refused): ChangePoint {
  return {
    bond_id: input.bond,
    timestamp: input.timestamp,
    digest: input.bytes.digest,
    raw_len: input.bytes.rawLen,
    encoding: input.bytes.encoding,
    decoded_sha256: input.bytes.decodedSha,
    text_len: textLenOf(input.bytes),
    text_truncated: false,
    qualified: false,
    failed_gates: input.failedGates,
    gate_c_hits: String(input.gateCHits ?? 0),
    classification: "",
    excerpt: "",
    rationale: "",
    observed_at: input.observedAt,
  };
}

const UNCHANGED = "The digest equals the baseline digest, so the bytes are the bytes already read.";

/* ------------------------------------------------------------------------- *
 * Bond 1: the long quiet bond. Two collapsible runs split by one blank frame.
 * ------------------------------------------------------------------------- */

const B1 = "HF-0114";
const B1_COMMITMENT = "We do not train models on customer data.";

const B1_BYTES: Bytes = {
  digest: "PQ4TXKMJ7ZC2VLWH3RGNYD5BFOAU6SIE",
  rawLen: "72427",
  encoding: "gzip",
  decodedSha: "0x9c1f4a7d2e8b6053f1ac97dd420e5b38716c0af9d3e2145b8c76039eaf1d2b40",
  decodedLen: 372058,
};

/** The blank frame. A print stylesheet variant: the anchor survived, the document did not. */
const B1_PRINT_SHELL: Bytes = {
  digest: "H2ZLQ7XM4TCJ6VYAB3RDNW5FKUGOSPEI",
  rawLen: "8712",
  encoding: "gzip",
  decodedSha: "0x5e2c907af31d4b6850b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351da3",
  decodedLen: 41880,
  textLen: 612,
};

const B1_QUIET = [
  { t: "20250928113355", at: "2025-09-28T14:02:11Z" },
  { t: "20251012164410", at: "2025-10-13T02:19:40Z" },
  { t: "20251103092217", at: "2025-11-03T18:41:05Z" },
  { t: "20251121205902", at: "2025-11-22T07:33:29Z" },
  { t: "20260108074511", at: "2026-01-08T20:15:52Z" },
  { t: "20260122151933", at: "2026-01-23T04:48:16Z" },
  { t: "20260219103744", at: "2026-02-19T22:07:31Z" },
  { t: "20260311192015", at: "2026-03-12T05:52:44Z" },
  { t: "20260408060827", at: "2026-04-08T19:26:03Z" },
  { t: "20260522142250", at: "2026-05-23T01:10:57Z" },
  { t: "20260701081617", at: "2026-07-01T16:44:38Z" },
  { t: "20260812124405", at: "2026-08-12T12:52:10Z" },
];

const B1_POINTS: ChangePoint[] = [
  admitted({
    bond: B1,
    timestamp: "20250914081204",
    bytes: B1_BYTES,
    reading: "HOLDS",
    excerpt: B1_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim in the Customer content section, with no carve out attached to it.",
    observedAt: "2025-09-14T10:22:41Z",
  }),
  ...B1_QUIET.slice(0, 4).map((row) =>
    admitted({
      bond: B1,
      timestamp: row.t,
      bytes: B1_BYTES,
      reading: "HOLDS",
      excerpt: B1_COMMITMENT,
      rationale: UNCHANGED,
      observedAt: row.at,
    }),
  ),
  // The frame that must never look like the eleven around it. The replay was served, verified and
  // decoded; what came back was a print variant carrying the page title and none of the document.
  // Gate C found 1 of the required sections and gate D found no terminal marker, so nothing was
  // read from it in either direction.
  refused({
    bond: B1,
    timestamp: "20251215133048",
    bytes: B1_PRINT_SHELL,
    failedGates: "C,D",
    gateCHits: 1,
    observedAt: "2025-12-16T03:11:08Z",
  }),
  ...B1_QUIET.slice(4).map((row) =>
    admitted({
      bond: B1,
      timestamp: row.t,
      bytes: B1_BYTES,
      reading: "HOLDS",
      excerpt: B1_COMMITMENT,
      rationale: UNCHANGED,
      observedAt: row.at,
    }),
  ),
];

/* ------------------------------------------------------------------------- *
 * Bond 2: a claim standing, contest window open.
 * ------------------------------------------------------------------------- */

const B2 = "HF-0207";
const B2_COMMITMENT =
  "Customer content is retained for thirty days after deletion and is then purged from all systems.";

const B2_BYTES: Bytes = {
  digest: "TG6WQJ2XMPZ4CRLK7HDNY3VBFSAU5OIE",
  rawLen: "89652",
  encoding: "gzip",
  decodedSha: "0x3d5b1e88fa2c470961d7e3b0ac54f28d716b90ce4a2f8351dd6c07be9134af25",
  decodedLen: 819751,
};

/**
 * The measured chrome-only shell, and the reason this contract decompresses before it reads.
 *
 * 8,015 raw bytes inflated to 35,640 and carried 569 visible characters. Gate B passed, because
 * the page title was in the shell. Gate C found 0 of a required 4 sections and gate D found no
 * terminal marker, which is the whole reason C and D take their inputs from different places. A
 * build that read these bytes without inflating them would have found no clause at all and called
 * the commitment deleted, unanimously.
 */
const B2_SHELL: Bytes = {
  digest: "N7XZQ6MTJ4KPCWRL3HDVY2BGFSAU5OIE",
  rawLen: "8015",
  encoding: "gzip",
  decodedSha: "0x71ba0c4e93d2586f40b7ce29d1358a067f2b94ce0d3a851762bcf09ae435d1b4",
  decodedLen: 35640,
  textLen: 569,
};

const B2_FIRST: Bytes = {
  digest: "K4MZQ7TWXJ2PCNRL6HDVY3BGFSAU5OIE",
  rawLen: "111902",
  encoding: "gzip",
  decodedSha: "0x8f2a61c07db34e95a1f80c6b25d7e34918ba0cf25e3d174680bc9a3f21d5e047",
  decodedLen: 831447,
};

const B2_SECOND: Bytes = {
  digest: "ZP2XQ6MWTJ4KCNRL7HDVY3BGFSAU5OIE",
  rawLen: "112340",
  encoding: "gzip",
  decodedSha: "0xc4e7093b1a562d8f40b7ce29d1358a067f2b94ce0d3a851762bcf09ae435d128",
  decodedLen: 834009,
};

const B2_POINTS: ChangePoint[] = [
  admitted({
    bond: B2,
    timestamp: "20251104093311",
    bytes: B2_BYTES,
    reading: "HOLDS",
    excerpt: B2_COMMITMENT,
    rationale: "The quoted sentence appears verbatim under Retention, with no qualifying clause.",
    observedAt: "2025-11-04T15:40:02Z",
  }),
  admitted({
    bond: B2,
    timestamp: "20251202141728",
    bytes: B2_BYTES,
    reading: "HOLDS",
    excerpt: B2_COMMITMENT,
    rationale: UNCHANGED,
    observedAt: "2025-12-02T21:06:19Z",
  }),
  refused({
    bond: B2,
    timestamp: "20260204175503",
    bytes: B2_SHELL,
    failedGates: "C,D",
    gateCHits: 0,
    observedAt: "2026-02-05T02:29:44Z",
  }),
  admitted({
    bond: B2,
    timestamp: "20260302141728",
    bytes: B2_BYTES,
    reading: "HOLDS",
    excerpt: B2_COMMITMENT,
    rationale: UNCHANGED,
    observedAt: "2026-03-02T20:44:51Z",
  }),
  admitted({
    bond: B2,
    timestamp: "20260514093022",
    bytes: B2_FIRST,
    reading: "WEAKENED",
    excerpt:
      "Customer content is retained for thirty days after deletion and is then purged from all systems, except where retention is required for security, billing or legal purposes.",
    rationale:
      "The retention period is unchanged, but the purge is now conditional on three exceptions that the quoted commitment did not carry. Security, billing and legal purposes cover most reasons content would be kept, so the guarantee is narrower.",
    observedAt: "2026-05-14T17:03:12Z",
  }),
  admitted({
    bond: B2,
    timestamp: "20260701162455",
    bytes: B2_SECOND,
    reading: "WEAKENED",
    excerpt:
      "Customer content is retained for a period determined by the applicable service plan and may be retained where required for security, billing or legal purposes.",
    rationale:
      "The thirty day figure is gone and the retention period is now set by the service plan rather than stated. A reader of this capture cannot learn how long content is kept, which the quoted commitment told them.",
    observedAt: "2026-08-20T06:31:44Z",
  }),
];

/* ------------------------------------------------------------------------- *
 * Bond 3: contested. The promisor says the commitment moved.
 * ------------------------------------------------------------------------- */

const B3 = "HF-0188";
const B3_COMMITMENT =
  "We will give ninety days notice in writing before any change that reduces the availability commitment.";

const B3_BYTES: Bytes = {
  digest: "MQ7ZXK2TJ4WPCNRL6HDVY3BGFSAU5OIE",
  rawLen: "61023",
  encoding: "gzip",
  decodedSha: "0x2b8d40f7ea16c953d17b0ace54f8d29617ba90ce4d2f83511d6c07be91340a2f",
  decodedLen: 696794,
};

const B3_GONE: Bytes = {
  digest: "R5ZXQ6MTJ4KPCNWL7HDVY2BGFSAU3OIE",
  rawLen: "51163",
  encoding: "gzip",
  decodedSha: "0xe1c740a93b26d58f70b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d82",
  decodedLen: 364722,
};

const B3_POINTS: ChangePoint[] = [
  admitted({
    bond: B3,
    timestamp: "20251218104502",
    bytes: B3_BYTES,
    reading: "HOLDS",
    excerpt: B3_COMMITMENT,
    rationale: "The quoted sentence appears verbatim under Changes to this agreement.",
    observedAt: "2025-12-18T16:20:33Z",
  }),
  admitted({
    bond: B3,
    timestamp: "20260129024608",
    bytes: B3_BYTES,
    reading: "HOLDS",
    excerpt: B3_COMMITMENT,
    rationale: UNCHANGED,
    observedAt: "2026-01-29T11:14:20Z",
  }),
  admitted({
    bond: B3,
    timestamp: "20260416133910",
    bytes: B3_GONE,
    reading: "ABSENT",
    excerpt: "Changes to this agreement take effect when posted to this page.",
    rationale:
      "The Changes to this agreement section is present and gives no notice period. Neither ninety days nor any other notice period appears anywhere in the decoded text. The excerpt is the whole of what the section now says on the subject.",
    observedAt: "2026-04-16T22:41:07Z",
  }),
  // Same digest as the capture before it: the page did not change again, and it still carries no
  // notice period. Two consecutive qualified captures reading absent is what claims a breach.
  admitted({
    bond: B3,
    timestamp: "20260603091544",
    bytes: B3_GONE,
    reading: "ABSENT",
    excerpt: "Changes to this agreement take effect when posted to this page.",
    rationale:
      "The digest is unchanged from the previous capture and still carries no notice period. Two consecutive qualified captures now read the commitment as absent from this URL.",
    observedAt: "2026-08-11T14:07:52Z",
  }),
];

/* ------------------------------------------------------------------------- *
 * Bond 4: settled against the promisor.
 * ------------------------------------------------------------------------- */

const B4 = "HF-0342";
const B4_COMMITMENT =
  "Advertising identifiers are never shared with third parties for their own marketing purposes.";
const B4_WEAK_TEXT =
  "Advertising identifiers are not shared with third parties for their own marketing purposes without your consent.";

const B4_BYTES: Bytes = {
  digest: "CQ7ZXK2TJ4WPMNRL6HDVY3BGFSAU5OIE",
  rawLen: "178326",
  encoding: "identity",
  decodedSha: "0x5a3c81f0be27d46915b8ace0d47f28361b7a90ce4d2f83511d6c07be9134af08",
  decodedLen: 178326,
};

const B4_WEAK: Bytes = {
  digest: "D5ZXQ6MTJ4KPCNWL7HDVY2BGFSAU3OIE",
  rawLen: "189440",
  encoding: "identity",
  decodedSha: "0x77bd2e409a13c586f0b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d09",
  decodedLen: 189440,
};

const B4_POINTS: ChangePoint[] = [
  admitted({
    bond: B4,
    timestamp: "20250408112044",
    bytes: B4_BYTES,
    reading: "HOLDS",
    excerpt: B4_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim under Advertising. The payload carried no recognised compression magic bytes, so it was read as identity and no inflation was attempted.",
    observedAt: "2025-04-08T18:02:10Z",
  }),
  admitted({
    bond: B4,
    timestamp: "20250530181101",
    bytes: B4_BYTES,
    reading: "HOLDS",
    excerpt: B4_COMMITMENT,
    rationale: UNCHANGED,
    observedAt: "2025-05-30T23:44:51Z",
  }),
  admitted({
    bond: B4,
    timestamp: "20251014073322",
    bytes: B4_WEAK,
    reading: "WEAKENED",
    excerpt: B4_WEAK_TEXT,
    rationale:
      "The word never has become not without your consent. A commitment that can be satisfied by obtaining consent is narrower than one that admits no exception.",
    observedAt: "2025-10-14T13:19:37Z",
  }),
  admitted({
    bond: B4,
    timestamp: "20251129145812",
    bytes: B4_WEAK,
    reading: "WEAKENED",
    excerpt: B4_WEAK_TEXT,
    rationale:
      "The digest is unchanged from the previous capture. Two consecutive qualified captures now read the commitment as narrower than the quoted one.",
    observedAt: "2025-11-29T21:02:44Z",
  }),
];

/* ------------------------------------------------------------------------- *
 * Bond 5: the term ran out with the wording intact.
 * ------------------------------------------------------------------------- */

const B5 = "HF-0119";
const B5_COMMITMENT =
  "Source code for the released binaries is published under the terms of the GNU General Public License.";

const B5_BYTES: Bytes = {
  digest: "VQ7ZXK2TJ4WPMNRL6HDCY3BGFSAU5OIE",
  rawLen: "31940",
  encoding: "zlib",
  decodedSha: "0x1f8a40c93b26d58f70b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d3c",
  decodedLen: 245117,
};

const B5_QUIET = [
  { t: "20250318141022", at: "2025-03-18T20:12:41Z" },
  { t: "20250602103917", at: "2025-06-02T16:33:08Z" },
  { t: "20250829075544", at: "2025-08-29T13:20:55Z" },
  { t: "20251117162203", at: "2025-11-17T22:04:19Z" },
  { t: "20260112084430", at: "2026-01-12T14:50:37Z" },
];

const B5_POINTS: ChangePoint[] = [
  admitted({
    bond: B5,
    timestamp: "20250124091133",
    bytes: B5_BYTES,
    reading: "HOLDS",
    excerpt: B5_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim under Licensing. The payload began with magic byte 78, so it was inflated as zlib before any text was extracted.",
    gateCHits: 3,
    observedAt: "2025-01-24T15:41:20Z",
  }),
  ...B5_QUIET.map((row) =>
    admitted({
      bond: B5,
      timestamp: row.t,
      bytes: B5_BYTES,
      reading: "HOLDS",
      excerpt: B5_COMMITMENT,
      rationale: UNCHANGED,
      gateCHits: 3,
      observedAt: row.at,
    }),
  ),
];

/* ------------------------------------------------------------------------- *
 * Bond 6: a reading the validators could not resolve.
 * ------------------------------------------------------------------------- */

const B6 = "HF-0301";
const B6_COMMITMENT =
  "Accounts are never suspended without written notice and an opportunity to respond.";

const B6_BYTES: Bytes = {
  digest: "JQ7ZXK2TW4PMCNRL6HDVY3BGFSAU5OIE",
  rawLen: "2044592",
  encoding: "identity",
  decodedSha: "0x93d4e0af1b27c56850b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d5b",
  decodedLen: 2044592,
};

/** A full document that is a different document. Gate B is the only gate that can catch this. */
const B6_SUBSTITUTE: Bytes = {
  digest: "L9ZXQ6MTJ4KPCNWL7HDVY2BGFSAU3OIE",
  rawLen: "142869",
  encoding: "gzip",
  decodedSha: "0xa07b3ce419d2586f40b7ce29d1358a067f2b94ce0d3a851762bcf09ae435d1f6",
  decodedLen: 928651,
};

const B6_LATER: Bytes = {
  digest: "B8ZXQ4MTJ6KPCNWL7HDVY2BGFSAU3OIE",
  rawLen: "2101440",
  encoding: "identity",
  decodedSha: "0xd52b8ce4179a0f6850b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351dc7",
  decodedLen: 2101440,
};

const B6_POINTS: ChangePoint[] = [
  admitted({
    bond: B6,
    timestamp: "20260316010536",
    bytes: B6_BYTES,
    reading: "HOLDS",
    excerpt: B6_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim under Suspension. The payload came in at 2,044,592 raw bytes, inside the 2,500,000 cap.",
    observedAt: "2026-03-16T08:14:02Z",
  }),
  // A complete, well formed page that is not this page. Gate C found its sections and gate D
  // found a terminal marker, because it is a real document; gate B is what noticed that the
  // anchor derived from this URL is nowhere in it.
  refused({
    bond: B6,
    timestamp: "20260609082217",
    bytes: B6_SUBSTITUTE,
    failedGates: "B",
    gateCHits: 4,
    observedAt: "2026-06-09T15:20:41Z",
  }),
  admitted({
    bond: B6,
    timestamp: "20260722140955",
    bytes: B6_LATER,
    reading: "INDETERMINATE",
    excerpt:
      "We may suspend an account where continued access presents a risk to the service or to other customers, and will notify the account holder.",
    rationale:
      "The validators did not agree on one reading. The notice requirement survives in some form and the opportunity to respond is not stated, and they split on whether that is narrower or merely reordered. An unresolved reading breaks the run and moves nothing.",
    observedAt: "2026-08-22T09:41:33Z",
  }),
];

/* ------------------------------------------------------------------------- *
 * Bond 7: created yesterday. One frame, and no history to read into it.
 * ------------------------------------------------------------------------- */

const B7 = "HF-0330";
const B7_COMMITMENT =
  "Deletion requests are completed within seven days and are confirmed by email when they are.";

const B7_BYTES: Bytes = {
  digest: "XQ7ZWK2TJ4PMCNRL6HDVY3BGFSAU5OIE",
  rawLen: "72427",
  encoding: "gzip",
  decodedSha: "0x6b2e91af40d3c57850b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d90",
  decodedLen: 372058,
};

const B7_POINTS: ChangePoint[] = [
  admitted({
    bond: B7,
    timestamp: "20260822123203",
    bytes: B7_BYTES,
    reading: "HOLDS",
    excerpt: B7_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim under Your rights. 47,441 raw bytes inflated to 372,058, which is the measured expansion for a page of this shape.",
    observedAt: "2026-08-24T09:12:44Z",
  }),
];

/* ------------------------------------------------------------------------- *
 * Bond 8: every capture since the baseline has been refused.
 *
 * The most important bond in the fixture set. Six captures recorded after the baseline, none
 * admitted, checks_passed still 0. Each was served, verified against the archive's own digest and
 * decoded, and each turned out to be something other than the document. An interface that let this
 * look like a quiet bond would be committing the exact error the product exists to prevent: four
 * real companies' terms pages produced this shape, and a build that skipped decompression read
 * every one of them as a page with every clause deleted.
 * ------------------------------------------------------------------------- */

const B8 = "HF-0255";
const B8_COMMITMENT =
  "We will not introduce advertising into the product for paying subscribers at any tier.";

const B8_BYTES: Bytes = {
  digest: "YQ7ZXK2TJ4WPMNRL6HDVC3BGFSAU5OIE",
  rawLen: "215912",
  encoding: "gzip",
  decodedSha: "0x40c9e1af3b27d56850b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d2e",
  decodedLen: 1056588,
};

const B8_REFUSALS: Array<{
  t: string;
  bytes: Bytes;
  gates: string;
  hits: number;
  at: string;
}> = [
  {
    t: "20260421081455",
    bytes: {
      digest: "F2ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "9204",
      encoding: "gzip",
      decodedSha: "0x1a7c4e93d2f50689314ac07be2d5f38716c0af9d3e2145b8c76039eaf1d2b4a1",
      decodedLen: 44180,
      textLen: 741,
    },
    gates: "C,D",
    hits: 0,
    at: "2026-04-21T14:22:07Z",
  },
  {
    t: "20260503104022",
    bytes: {
      digest: "G3ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "8866",
      encoding: "gzip",
      decodedSha: "0x2b8d5fa4e30617a0125bd18cf3e6049827d1b0ae4f3256c9d87140fbb0e3c5b2",
      decodedLen: 42311,
      textLen: 688,
    },
    gates: "C,D",
    hits: 0,
    at: "2026-05-03T17:40:19Z",
  },
  {
    t: "20260519162744",
    bytes: {
      digest: "H4ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "38220",
      encoding: "gzip",
      decodedSha: "0x3c9e60b5f41728b1236ce29da4f715a938e2c1bf504367dae98251fcc1f4d6c3",
      decodedLen: 288104,
      textLen: 21402,
    },
    gates: "D",
    hits: 4,
    at: "2026-05-19T23:11:52Z",
  },
  {
    t: "20260614093311",
    bytes: {
      digest: "J5ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "39117",
      encoding: "gzip",
      decodedSha: "0x4dea710c6052839c247df3aeb5082ba49f3d2c0615478ebfa9362add2f05e7d4",
      decodedLen: 291770,
      textLen: 22118,
    },
    gates: "C",
    hits: 1,
    at: "2026-06-14T16:02:33Z",
  },
  {
    t: "20260708115206",
    bytes: {
      digest: "K6ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "41008",
      encoding: "identity",
      decodedSha: "0x5fb821d7163940d358ea4bfc6193cb50a4e3d1726589fc0ba473bee3016f8e45",
      decodedLen: 41008,
      textLen: 1893,
    },
    gates: "B,C,D",
    hits: 0,
    at: "2026-07-08T18:44:10Z",
  },
  {
    t: "20260803141930",
    bytes: {
      digest: "L7ZXQ6MTJ4KPCNWL7HDVY3BGRSAU5OIE",
      rawLen: "9530",
      encoding: "gzip",
      decodedSha: "0x60c932e8274a51e469fb5c0d72a4dc61b5f4e28376a90d1cb584cff4127a95f6",
      decodedLen: 45992,
      textLen: 803,
    },
    gates: "C,D",
    hits: 1,
    at: "2026-08-03T20:19:41Z",
  },
];

const B8_POINTS: ChangePoint[] = [
  admitted({
    bond: B8,
    timestamp: "20260318074512",
    bytes: B8_BYTES,
    reading: "HOLDS",
    excerpt: B8_COMMITMENT,
    rationale:
      "The quoted sentence appears verbatim under Subscriptions. 134,882 raw bytes inflated to 1,056,588.",
    observedAt: "2026-03-18T14:20:55Z",
  }),
  ...B8_REFUSALS.map((row) =>
    refused({
      bond: B8,
      timestamp: row.t,
      bytes: row.bytes,
      failedGates: row.gates,
      gateCHits: row.hits,
      observedAt: row.at,
    }),
  ),
];

/* ------------------------------------------------------------------------- *
 * Bond 9: one weakening, then the page went back. Nothing moved, correctly.
 * ------------------------------------------------------------------------- */

const B9 = "HF-0263";
const B9_COMMITMENT =
  "Uptime below ninety nine point nine percent in any month earns an automatic service credit.";

const B9_BYTES: Bytes = {
  digest: "AQ7ZXK2TJ4WPMNRL6HDVY3BGFSAU5OIE",
  rawLen: "19204",
  encoding: "gzip",
  decodedSha: "0x2ea70cbf419d3568f0b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d74",
  decodedLen: 148772,
};

const B9_DIP: Bytes = {
  digest: "M1ZXQ6MTJ4KPCNWL7HDVY2BGFSAU3OIE",
  rawLen: "19488",
  encoding: "gzip",
  decodedSha: "0xbe4107af29d35568f0b4ce19d235870a6f2b94ce0d3a851762bcf09ae4351d18",
  decodedLen: 150014,
};

const B9_POINTS: ChangePoint[] = [
  admitted({
    bond: B9,
    timestamp: "20260215113044",
    bytes: B9_BYTES,
    reading: "HOLDS",
    excerpt: B9_COMMITMENT,
    rationale: "The quoted sentence appears verbatim under Service credits.",
    gateCHits: 3,
    observedAt: "2026-02-15T18:02:19Z",
  }),
  admitted({
    bond: B9,
    timestamp: "20260408091522",
    bytes: B9_DIP,
    reading: "WEAKENED",
    excerpt:
      "Uptime below ninety nine point nine percent in any month may earn a service credit on request.",
    rationale:
      "Automatic has become on request, and earns has become may earn. Both changes move the credit from a guarantee to a discretion.",
    gateCHits: 3,
    observedAt: "2026-04-08T15:44:03Z",
  }),
  admitted({
    bond: B9,
    timestamp: "20260527142811",
    bytes: B9_BYTES,
    reading: "HOLDS",
    excerpt: B9_COMMITMENT,
    rationale:
      "The digest is back to the baseline digest byte for byte, so the previous wording was reverted. One weakened capture with no qualified weakening beside it moves nothing.",
    gateCHits: 3,
    observedAt: "2026-05-27T21:07:44Z",
  }),
  admitted({
    bond: B9,
    timestamp: "20260814103955",
    bytes: B9_BYTES,
    reading: "HOLDS",
    excerpt: B9_COMMITMENT,
    rationale: UNCHANGED,
    gateCHits: 3,
    observedAt: "2026-08-25T07:22:10Z",
  }),
];

const MOCK_POINTS: Record<string, ChangePoint[]> = {
  [B1]: B1_POINTS,
  [B2]: B2_POINTS,
  [B3]: B3_POINTS,
  [B4]: B4_POINTS,
  [B5]: B5_POINTS,
  [B6]: B6_POINTS,
  [B7]: B7_POINTS,
  [B8]: B8_POINTS,
  [B9]: B9_POINTS,
};

/* ------------------------------------------------------------------------- *
 * Bonds
 * ------------------------------------------------------------------------- */

const PROMISOR_1 = "0x7A4bE39c1D0f85B2a6C7e41F3b89dC5e02A1f6B4";
const PROMISOR_2 = "0x2E91cB47a5D0f83B16C7e4aF39b8dC5e70A1f2C8";
const PROMISOR_3 = "0xB53a0C7e419dF862A1c7e40b39D8c5E27fA0146D";
const PROMISOR_4 = "0x64Fa1c0B7e419d3286a1C7e40b39D8c5e27fA015";
const PROMISOR_5 = "0x0aE5b47c19D8f3625a1C7e40b39d8C5e27Fa0163";
const PROMISOR_6 = "0x3fA0146a1C7e40b39d8c5E27fa0146a1c7E40B39";
const PROMISOR_7 = "0xA1c7E40b39d8C5e27fa0146a1C7e40b39D8c5E27";
const PROMISOR_8 = "0x9d8C5e27fA0146a1c7E40b39d8c5e27Fa0146A1c";
const PROMISOR_9 = "0x146a1c7E40b39d8C5e27fa0146A1c7e40b39D8c5";

const PAYEE_1 = "0xF10c3D7a48B9e2561A0c7E43b9d85C2e7fA019B6";
const PAYEE_2 = "0x38D7ac0B4e19F2685a1C7e40b39d8C5e27Fa014E";
const PAYEE_3 = "0x9C0e5A78b41dF3629a1c7E40B39d8c5e27fA013B";
const PAYEE_4 = "0xC7e401b39D8c5E27fA0146a1c7e40B39d8C5e274";
const PAYEE_5 = "0x5e27Fa0146a1c7E40b39D8c5e27fa0146A1c7E40";
const PAYEE_6 = "0xd8C5e27fA0146a1c7e40B39d8c5E27fa0146A1c7";
const PAYEE_7 = "0x46a1C7e40b39d8c5E27fa0146a1c7E40b39D8c5e";
const PAYEE_8 = "0x27fa0146A1c7e40B39d8c5E27fa0146a1C7e40B3";
const PAYEE_9 = "0xe40B39d8c5e27Fa0146a1C7e40b39d8C5e27fA01";

/**
 * Everything a fixture bond states in its own right.
 *
 * The eleven fields the contract derives are not here, and are computed below instead:
 * `anchor` from the URL, `anchor_words` as the JSON array the contract stores, `commitment_sha256`
 * as a stable stand-in, and `cursor_timestamp`, `last_checked_at` and `points_recorded` from the
 * bond's own change points. Deriving them is what keeps a fixture from asserting a cursor that no
 * recorded capture reaches, which is a disagreement the frame strip would draw and no reader could
 * explain.
 */
type BondSeed = {
  id: string;
  promisor: string;
  payee: string;
  url: string;
  commitment: string;
  words: string[];
  terminal: string;
  stake: string;
  termDays: number;
  createdAt: string;
  state: BondState;
  checksPassed: number;
  runLength?: number;
  runFirst?: string;
  breach?: {
    firstTimestamp: string;
    firstDigest: string;
    secondTimestamp: string;
    secondDigest: string;
    excerpt: string;
    rationale: string;
    claimedAt: string;
    deadline: string;
  };
  contest?: {
    url: string;
    timestamp: string;
    bond: string;
    outcome: "" | "UPHELD" | "FAILED";
    at: string;
  };
  settlement?: {
    at: string;
    paidToPayee: string;
    returnedToPromisor: string;
  };
};

/**
 * Gate B's anchor, derived rather than stated.
 *
 * `deriveAnchor` is the mirror of `Holdfast.py:2050`, so a fixture anchor is whatever the contract
 * would have produced from that URL and cannot be typed into disagreement with it. This matters:
 * the derivation replaces hyphens with spaces, so `/model-terms` stores `model terms`, and a
 * fixture that wrote the hyphenated form would have shown a phrase gate B never looked for.
 */
function anchorFromUrl(url: string): string {
  return deriveAnchor(url);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
}

function bondFrom(seed: BondSeed): Bond {
  const points = MOCK_POINTS[seed.id] ?? [];
  const last = points[points.length - 1];
  const baseline = points[0];
  return {
    bond_id: seed.id,
    promisor: seed.promisor,
    payee: seed.payee,
    url: seed.url,
    commitment: seed.commitment,
    commitment_sha256: `0x${normalizeCommitment(seed.commitment).length.toString(16).padStart(4, "0")}${seed.id.replace(/\D/g, "")}${"".padEnd(52, "0")}`,
    anchor: anchorFromUrl(seed.url),
    anchor_words: JSON.stringify(seed.words),
    anchor_terminal: seed.terminal,
    baseline_timestamp: baseline?.timestamp ?? "",
    baseline_digest: baseline?.digest ?? "",
    baseline_encoding: baseline?.encoding ?? "",
    stake: seed.stake,
    term_days: String(seed.termDays),
    created_at: seed.createdAt,
    expires_at: addDays(seed.createdAt, seed.termDays),
    state: seed.state,
    cursor_timestamp: last?.timestamp ?? "",
    last_checked_at: last?.observed_at ?? "",
    checks_passed: String(seed.checksPassed),
    points_recorded: String(points.length),
    run_length: String(seed.runLength ?? 0),
    run_first_timestamp: seed.runFirst ?? "",
    breach_first_timestamp: seed.breach?.firstTimestamp ?? "",
    breach_first_digest: seed.breach?.firstDigest ?? "",
    breach_second_timestamp: seed.breach?.secondTimestamp ?? "",
    breach_second_digest: seed.breach?.secondDigest ?? "",
    breach_excerpt: seed.breach?.excerpt ?? "",
    breach_rationale: seed.breach?.rationale ?? "",
    claimed_at: seed.breach?.claimedAt ?? "",
    contest_deadline: seed.breach?.deadline ?? "",
    contest_url: seed.contest?.url ?? "",
    contest_timestamp: seed.contest?.timestamp ?? "",
    contest_bond: seed.contest?.bond ?? "0",
    contest_outcome: seed.contest?.outcome ?? "",
    contested_at: seed.contest?.at ?? "",
    settled_at: seed.settlement?.at ?? "",
    settled: Boolean(seed.settlement),
    paid_to_payee: seed.settlement?.paidToPayee ?? "0",
    returned_to_promisor: seed.settlement?.returnedToPromisor ?? "0",
  };
}

const GEN = (whole: number) => `${whole}${"".padEnd(18, "0")}`;

export const MOCK_BONDS: Bond[] = [
  bondFrom({
    id: B1,
    promisor: PROMISOR_1,
    payee: PAYEE_1,
    url: "https://terms.northwind.example/model-terms",
    commitment: B1_COMMITMENT,
    words: ["northwind", "model", "terms", "customer", "content"],
    terminal: "End of Model Terms",
    stake: GEN(250),
    termDays: 365,
    createdAt: "2025-09-14T10:22:41Z",
    state: "ACTIVE",
    checksPassed: 13,
  }),
  bondFrom({
    id: B2,
    promisor: PROMISOR_2,
    payee: PAYEE_2,
    url: "https://policy.contoso.example/data-retention",
    commitment: B2_COMMITMENT,
    words: ["contoso", "cloud", "services", "retention", "policy"],
    terminal: "Last reviewed",
    stake: GEN(80),
    termDays: 365,
    createdAt: "2025-11-04T15:40:02Z",
    state: "BREACH_CLAIMED",
    checksPassed: 4,
    runLength: 2,
    runFirst: "20260514093022",
    breach: {
      firstTimestamp: "20260514093022",
      firstDigest: B2_FIRST.digest,
      secondTimestamp: "20260701162455",
      secondDigest: B2_SECOND.digest,
      excerpt:
        "Customer content is retained for a period determined by the applicable service plan and may be retained where required for security, billing or legal purposes.",
      rationale:
        "The thirty day figure is gone and the retention period is now set by the service plan rather than stated. A reader of this capture cannot learn how long content is kept, which the quoted commitment told them.",
      claimedAt: "2026-08-20T06:31:44Z",
      deadline: "2026-08-27T06:31:44Z",
    },
  }),
  bondFrom({
    id: B3,
    promisor: PROMISOR_3,
    payee: PAYEE_3,
    url: "https://sla.fabrikam.example/availability",
    commitment: B3_COMMITMENT,
    words: ["fabrikam", "service", "level", "availability", "commitment"],
    terminal: "Effective date",
    stake: GEN(500),
    termDays: 548,
    createdAt: "2025-12-18T16:20:33Z",
    state: "CONTESTED",
    checksPassed: 3,
    runLength: 2,
    runFirst: "20260416133910",
    breach: {
      firstTimestamp: "20260416133910",
      firstDigest: B3_GONE.digest,
      secondTimestamp: "20260603091544",
      secondDigest: B3_GONE.digest,
      excerpt: "Changes to this agreement take effect when posted to this page.",
      rationale:
        "The digest is unchanged from the previous capture and still carries no notice period. Two consecutive qualified captures now read the commitment as absent from this URL.",
      claimedAt: "2026-08-11T14:07:52Z",
      deadline: "2026-08-18T14:07:52Z",
    },
    contest: {
      url: "https://sla.fabrikam.example/legal/service-terms",
      timestamp: "20260705093344",
      bond: GEN(50),
      outcome: "",
      at: "2026-08-14T09:11:20Z",
    },
  }),
  bondFrom({
    id: B4,
    promisor: PROMISOR_4,
    payee: PAYEE_4,
    url: "https://privacy.tailspin.example/advertising",
    commitment: B4_COMMITMENT,
    words: ["tailspin", "toys", "privacy", "advertising", "identifiers"],
    terminal: "Contact the privacy office",
    stake: GEN(120),
    termDays: 365,
    createdAt: "2025-04-08T18:02:10Z",
    state: "BREACHED",
    checksPassed: 3,
    runLength: 2,
    runFirst: "20251014073322",
    breach: {
      firstTimestamp: "20251014073322",
      firstDigest: B4_WEAK.digest,
      secondTimestamp: "20251129145812",
      secondDigest: B4_WEAK.digest,
      excerpt: B4_WEAK_TEXT,
      rationale:
        "The digest is unchanged from the previous capture. Two consecutive qualified captures now read the commitment as narrower than the quoted one.",
      claimedAt: "2025-11-29T21:02:44Z",
      deadline: "2025-12-06T21:02:44Z",
    },
    settlement: {
      at: "2025-12-07T04:18:52Z",
      paidToPayee: GEN(120),
      returnedToPromisor: "0",
    },
  }),
  bondFrom({
    id: B5,
    promisor: PROMISOR_5,
    payee: PAYEE_5,
    url: "https://releases.adventure-works.example/licensing",
    commitment: B5_COMMITMENT,
    words: ["adventure", "works", "release", "notes", "licensing"],
    terminal: "Report a licensing issue",
    stake: GEN(40),
    termDays: 365,
    createdAt: "2025-01-24T15:41:20Z",
    state: "RETURNED",
    checksPassed: 5,
    settlement: {
      at: "2026-01-25T09:02:14Z",
      paidToPayee: "0",
      returnedToPromisor: GEN(40),
    },
  }),
  bondFrom({
    id: B6,
    promisor: PROMISOR_6,
    payee: PAYEE_6,
    url: "https://legal.wingtip.example/acceptable-use",
    commitment: B6_COMMITMENT,
    words: ["wingtip", "toys", "acceptable", "use", "suspension"],
    terminal: "Version history",
    stake: GEN(60),
    termDays: 365,
    createdAt: "2026-03-16T08:14:02Z",
    state: "ACTIVE",
    checksPassed: 1,
  }),
  bondFrom({
    id: B7,
    promisor: PROMISOR_7,
    payee: PAYEE_7,
    url: "https://help.litware.example/data-deletion",
    commitment: B7_COMMITMENT,
    words: ["litware", "help", "centre", "data", "deletion"],
    terminal: "Was this article helpful",
    stake: GEN(25),
    termDays: 90,
    createdAt: "2026-08-24T09:12:44Z",
    state: "ACTIVE",
    checksPassed: 0,
  }),
  bondFrom({
    id: B8,
    promisor: PROMISOR_8,
    payee: PAYEE_8,
    url: "https://about.proseware.example/subscription-promise",
    commitment: B8_COMMITMENT,
    words: ["proseware", "subscription", "promise", "paying", "subscribers"],
    terminal: "Questions about your plan",
    stake: GEN(150),
    termDays: 365,
    createdAt: "2026-03-18T14:20:55Z",
    state: "ACTIVE",
    checksPassed: 0,
  }),
  bondFrom({
    id: B9,
    promisor: PROMISOR_9,
    payee: PAYEE_9,
    url: "https://sla.coho-vineyard.example/service-credits",
    commitment: B9_COMMITMENT,
    words: ["coho", "vineyard", "service", "level", "credits"],
    terminal: "How to claim a credit",
    stake: GEN(90),
    termDays: 365,
    createdAt: "2026-02-15T18:02:19Z",
    state: "ACTIVE",
    checksPassed: 4,
  }),
];

/* ------------------------------------------------------------------------- *
 * View shapes
 * ------------------------------------------------------------------------- */

export function mockBond(bondId: string): Bond | undefined {
  return MOCK_BONDS.find((entry) => entry.bond_id === bondId);
}

/** The eight fields `list_bonds` returns, and not a `Bond` narrowed at the call site. */
export function mockSummaries(): BondSummary[] {
  return MOCK_BONDS.map((entry) => ({
    bond_id: entry.bond_id,
    url: entry.url,
    state: entry.state,
    stake: entry.stake,
    expires_at: entry.expires_at,
    cursor_timestamp: entry.cursor_timestamp,
    checks_passed: entry.checks_passed,
    points_recorded: entry.points_recorded,
  }));
}

export function mockHistory(bondId: string): ChangePoint[] | undefined {
  if (!mockBond(bondId)) return undefined;
  return MOCK_POINTS[bondId] ?? [];
}

/**
 * `commitment_status(bond_id)`, tallied the same way the contract tallies it.
 *
 * The counts are computed from the change points rather than stated, which is the only way a
 * fixture can be sure it agrees with the history the same page draws. `Holdfast.py:3230` walks
 * the points in exactly this order and counts a classification only when one is present, so a
 * refused capture raises `examined` and `gate_rejected` and none of the four readings.
 */
export function mockStatus(bondId: string): CommitmentStatus | undefined {
  const bond = mockBond(bondId);
  if (!bond) return undefined;
  const points = MOCK_POINTS[bondId] ?? [];
  const count = (reading: CommitmentReading) =>
    String(points.filter((point) => point.classification === reading).length);
  const qualified = points.filter((point) => point.qualified);
  return {
    bond_id: bond.bond_id,
    state: bond.state,
    url: bond.url,
    commitment: bond.commitment,
    baseline_timestamp: bond.baseline_timestamp,
    cursor_timestamp: bond.cursor_timestamp,
    last_checked_at: bond.last_checked_at,
    expires_at: bond.expires_at,
    examined: String(points.length),
    qualified: String(qualified.length),
    gate_rejected: String(points.length - qualified.length),
    holds: count("HOLDS"),
    weakened: count("WEAKENED"),
    absent: count("ABSENT"),
    indeterminate: count("INDETERMINATE"),
    run_length: bond.run_length,
    breach_run_needed: "2",
    last_qualified_timestamp: qualified[qualified.length - 1]?.timestamp ?? "",
  };
}

function sumWei(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value || "0"), 0n).toString();
}

/**
 * `get_ledger`, and every figure in it is cumulative.
 *
 * `total_escrowed` is everything the contract has ever taken in, stakes and contest bonds
 * together, and it is never decremented when a bond settles. What is still held is
 * `total_escrowed` minus the two payout totals, and it is left to the caller to subtract rather
 * than published as a fourth number, because a contract that reported a balance it did not
 * compute from its own transfers would be reporting a belief.
 */
export const MOCK_LEDGER: Ledger = {
  total_escrowed: sumWei([
    ...MOCK_BONDS.map((entry) => entry.stake),
    ...MOCK_BONDS.map((entry) => entry.contest_bond),
  ]),
  total_paid_to_payees: sumWei(MOCK_BONDS.map((entry) => entry.paid_to_payee)),
  total_returned_to_promisors: sumWei(MOCK_BONDS.map((entry) => entry.returned_to_promisor)),
  bonds_created: String(MOCK_BONDS.length),
  checks_run: "24",
  breaches_claimed: String(
    MOCK_BONDS.filter((entry) => entry.breach_first_timestamp !== "").length,
  ),
  contests_filed: String(MOCK_BONDS.filter((entry) => entry.contest_timestamp !== "").length),
  fee_basis_points: "0",
};

/**
 * `get_limits`, holding the contract's own constants.
 *
 * These are the values at `Holdfast.py:144-154`, `Holdfast.py:679` and `Holdfast.py:1715-1762`, in the
 * units the contract publishes them in: seconds for the two windows and basis points for the
 * contest bond.
 * `limitsDrift` in `contract-types.ts` compares them against the client mirror, and it is meant
 * to return nothing here, so a fixture that drifted from the contract would show up in fixture
 * mode as a named disagreement rather than as a form that quietly accepts a bad bond.
 */
export const MOCK_LIMITS: Limits = {
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
};
