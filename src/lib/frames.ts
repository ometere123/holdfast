/**
 * The frame strip, derived.
 *
 * One archived capture is one frame. Four kinds, and the distinction that matters most is
 * between two of them:
 *
 *   unchanged  the capture was retrieved, admitted, and the archive's index publishes the same
 *              digest for it as for the baseline. This is a fact about stored bytes.
 *   blank      the capture exists in the index and could not be admitted. Nothing was read
 *              from it, in either direction.
 *
 * A blank frame is not a quiet unchanged frame. The failure this defends against is a gzip
 * compressed replay that extracts to almost no text and therefore reads as every clause
 * having been deleted, unanimously, by every validator at once. Four major companies' terms
 * pages produced exactly that false reading. So the two are separated here, in data, before
 * any component gets a chance to blur them: they carry different kinds, different labels,
 * and a blank frame is never eligible for the collapse that hides unchanged frames.
 *
 * A blank frame always means a gate rejection, and never a network fault. A capture the archive
 * could not serve, or whose decoded body no longer hashes to the pin taken at the baseline, reverts
 * the whole check and is never recorded, so it cannot reach this file. What arrives here was
 * fetched and decoded; what a blank frame records is that the decoded document was refused as
 * evidence.
 *
 * Three fields this file used to read do not exist. There is no `digest_verified`, and its absence
 * is a limit rather than a tidy omission: the index digest is over the record as the archive stored
 * it, GenVM's transport undoes `Content-Encoding: gzip` before the contract sees the body, and once
 * the bytes arrive plain a mismatched digest and a transparently inflated record are the same
 * observation (`Holdfast.py:772`). So the contract records that state instead of refusing on it and
 * does not carry it out here, which is why the digest on a frame is provenance and `decoded_sha256`
 * is the integrity pin. There is no per-point fault tag, because admission is carried by `qualified`
 * plus `failed_gates`. And there is no `is_baseline`, because it is derivable, so this file derives
 * it rather than trusting a duplicate.
 */

import type { Bond, ChangePoint, CommitmentReading } from "./contract-types.ts";
import { formatCount, frameTick } from "./format.ts";

export type FrameKind = "baseline" | "unchanged" | "differs" | "blank";

/** The two bond fields a frame is judged against, together, so they cannot be passed swapped. */
export type Baseline = {
  digest: string;
  timestamp: string;
};

export function baselineOf(bond: Pick<Bond, "baseline_digest" | "baseline_timestamp">): Baseline {
  return { digest: bond.baseline_digest, timestamp: bond.baseline_timestamp };
}

export type Frame = {
  index: number;
  kind: FrameKind;
  timestamp: string;
  tick: string;
  digest: string;
  point: ChangePoint;
  /** Only ever set on an admitted frame. A blank frame carries no reading, by construction. */
  reading: CommitmentReading | "";
  /** True when the reading found the commitment narrower or gone. Drives the light table. */
  finding: boolean;
  /** Admitted and carrying no classification, which the contract cannot produce. A guard. */
  unaccounted: boolean;
  /** Comma joined gate letters, empty on an admitted frame. */
  failedGates: string;
  /** The one line printed under this frame. Never empty. */
  caption: string;
};

/**
 * Admitted means: retrieved, digest matched the index, decoded, and through every enabled gate.
 *
 * That is exactly what `qualified` records, and it is the only field the contract itself allows
 * a payout to branch on, so it is the only field this branches on either.
 */
export function isAdmitted(point: ChangePoint): boolean {
  return point.qualified;
}

/**
 * A shape the contract cannot produce: admitted, and carrying no classification.
 *
 * This is a guard and not an outcome. `_classification_of` raises `[LLM_ERROR]` on any answer
 * outside the four words and on any breach finding whose quote is not in the document, so an
 * unusable reading reverts the whole check and stores nothing. A qualified point therefore always
 * carries one of the four words, and this returns false on every point the deployed contract can
 * write.
 *
 * It is kept because the alternative is worse. If such a point ever did arrive, from a contract
 * upgrade or a decoding fault, the branches below would otherwise fall through to `digest
 * differs` and draw it as an ordinary examined capture with nothing found. Naming it instead
 * means the interface reports a capture it cannot account for rather than quietly presenting it
 * as reassurance.
 */
export function readingUnaccounted(point: ChangePoint): boolean {
  return point.qualified && point.classification === "";
}

export function frameKind(point: ChangePoint, baseline: Baseline): FrameKind {
  if (!isAdmitted(point)) return "blank";
  if (point.timestamp === baseline.timestamp) return "baseline";
  return point.digest === baseline.digest ? "unchanged" : "differs";
}

/** `B,D` becomes `gates B and D`. A caption names what decided, never just that something did. */
export function gatePhrase(failedGates: string): string {
  const letters = failedGates
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (letters.length === 0) return "not admitted";
  if (letters.length === 1) return `gate ${letters[0]} failed`;
  const last = letters[letters.length - 1];
  return `gates ${letters.slice(0, -1).join(", ")} and ${last} failed`;
}

function caption(kind: FrameKind, point: ChangePoint): string {
  if (kind === "blank") return gatePhrase(point.failed_gates);
  if (kind === "baseline") return "baseline";
  if (kind === "unchanged") return "digest unchanged";
  if (readingUnaccounted(point)) return "digest differs, no reading recorded";
  if (point.classification === "WEAKENED") return "digest differs, commitment narrower";
  if (point.classification === "ABSENT") return "digest differs, commitment not present";
  if (point.classification === "INDETERMINATE") return "digest differs, reading unresolved";
  if (point.classification === "HOLDS") return "digest differs, commitment holds";
  return "digest differs";
}

export function toFrames(points: ChangePoint[], baseline: Baseline): Frame[] {
  return points.map((point, index) => {
    const kind = frameKind(point, baseline);
    const reading = kind === "blank" ? "" : point.classification;
    return {
      index,
      kind,
      timestamp: point.timestamp,
      tick: frameTick(point.timestamp),
      digest: point.digest,
      point,
      reading,
      finding: kind === "differs" && (reading === "WEAKENED" || reading === "ABSENT"),
      unaccounted: kind !== "blank" && readingUnaccounted(point),
      failedGates: point.failed_gates,
      caption: caption(kind, point),
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Collapse
 * ------------------------------------------------------------------------- */

export type StripSegment =
  | { kind: "single"; frame: Frame }
  | { kind: "run"; frames: Frame[]; count: number; from: string; to: string; label: string };

/**
 * Runs of unchanged frames collapse into one segment, because a hundred identical frames
 * are one fact and not a hundred.
 *
 * `minRun` is 2 rather than 1 so a lone unchanged frame keeps its own timestamp on the
 * axis. Baseline, differing and blank frames are never eligible, at any width, which is
 * the rule that keeps a blank frame from being swallowed by the dimmed band beside it.
 */
export function stripSegments(frames: Frame[], minRun = 2): StripSegment[] {
  const segments: StripSegment[] = [];
  let run: Frame[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < minRun) {
      for (const frame of run) segments.push({ kind: "single", frame });
    } else {
      segments.push({
        kind: "run",
        frames: run,
        count: run.length,
        from: run[0].timestamp,
        to: run[run.length - 1].timestamp,
        label: `${formatCount(run.length)} frames · digest unchanged`,
      });
    }
    run = [];
  };

  for (const frame of frames) {
    if (frame.kind === "unchanged") {
      run.push(frame);
      continue;
    }
    flush();
    segments.push({ kind: "single", frame });
  }
  flush();
  return segments;
}

/* ------------------------------------------------------------------------- *
 * Counts, for the line that sits under the strip
 * ------------------------------------------------------------------------- */

export type FrameTally = {
  total: number;
  admitted: number;
  unchanged: number;
  differs: number;
  blank: number;
  findings: number;
  unaccounted: number;
};

export function tally(frames: Frame[]): FrameTally {
  const count = (kind: FrameKind) => frames.filter((frame) => frame.kind === kind).length;
  return {
    total: frames.length,
    admitted: frames.filter((frame) => frame.kind !== "blank").length,
    unchanged: count("unchanged") + count("baseline"),
    differs: count("differs"),
    blank: count("blank"),
    findings: frames.filter((frame) => frame.finding).length,
    unaccounted: frames.filter((frame) => frame.unaccounted).length,
  };
}

/**
 * The sentence under the strip.
 *
 * Blank frames are counted out loud and separately. A summary that folded them into the
 * admitted total would be the exact inference this product exists to prevent: it would let
 * a reader take an unreachable archive as an intact promise.
 */
export function tallySentence(counts: FrameTally): string {
  const admitted =
    counts.admitted === 1
      ? "1 capture was admitted"
      : `${formatCount(counts.admitted)} captures were admitted`;
  const blank =
    counts.blank === 0
      ? ""
      : counts.blank === 1
        ? ". 1 further capture could not be admitted and was not read"
        : `. ${formatCount(counts.blank)} further captures could not be admitted and were not read`;
  const moved =
    counts.differs === 0
      ? ", and none differed from the baseline digest"
      : counts.differs === 1
        ? ", and 1 differed from the baseline digest"
        : `, and ${formatCount(counts.differs)} differed from the baseline digest`;
  return `${admitted}${moved}${blank}.`;
}

/** The frame the light table belongs under: the first finding, else the last differing frame. */
export function lightTableFrame(frames: Frame[]): Frame | undefined {
  return frames.find((frame) => frame.finding) ?? [...frames].reverse().find((frame) => frame.kind === "differs");
}

/** Frames a mobile layout must render individually no matter how narrow the screen gets. */
export function neverCollapsed(frames: Frame[]): Frame[] {
  return frames.filter((frame) => frame.kind !== "unchanged");
}
