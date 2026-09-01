"use client";

/**
 * The reel: one archived capture per frame, and the light table under it.
 *
 * The whole component exists to keep two frames from looking alike. An unchanged frame is a fact
 * about bytes: the capture was retrieved, its sha1 matched the index digest the archive publishes,
 * it decoded, it passed every enabled gate, and it hashed to the same value as the baseline. A
 * blank frame is the absence of a fact: the bytes arrived and verified, and the decoded document
 * was refused as evidence. They differ on five independent axes here, exactly as the stylesheet
 * lays them out: interior, border, collapse eligibility, caption, and accessible name.
 *
 * Only unchanged runs collapse. A blank frame is never swallowed by the dimmed band beside it at
 * any width, because the false reading this product exists to prevent is a gzip replay extracting
 * to almost no text and reading as every clause deleted, unanimously. A collapsed blank frame is
 * that false reading with the evidence hidden.
 *
 * A collapsed run can be opened. The band says how many frames it stands for and the button beside
 * it renders them individually, because summarizing evidence is only honest while the summary is
 * reversible.
 */

import { useMemo, useState } from "react";
import type { Bond, ChangePoint } from "@/lib/contract-types";
import { ENCODING_TEXT, GATE_TEXT, READING_TEXT } from "@/lib/contract-types";
import type { Frame } from "@/lib/frames";
import {
  baselineOf,
  gatePhrase,
  lightTableFrame,
  stripSegments,
  tally,
  tallySentence,
  toFrames,
} from "@/lib/frames";
import { BLANK_FRAME_MEANING } from "@/lib/lifecycle";
import { displayTime, formatBytes, formatCount, frameMoment } from "@/lib/format";

const KIND_CLASS: Record<Frame["kind"], string> = {
  baseline: "hf-cell-baseline",
  unchanged: "hf-cell-unchanged",
  differs: "hf-cell-differs",
  blank: "hf-cell-blank",
};

/**
 * The accessible name, which is one of the five axes and not a restatement of the caption.
 *
 * A blank frame says what was not read and why. An unchanged frame says what was compared. Neither
 * borrows the other's wording, so a screen reader hears the same distinction the outline draws.
 */
function frameName(frame: Frame): string {
  const when = frameMoment(frame.timestamp);
  const number = `Frame ${frame.index + 1}, ${frame.tick}, ${when}.`;
  if (frame.kind === "blank") {
    return `${number} Not admitted: ${gatePhrase(frame.failedGates)}. Nothing was read from this capture, in either direction.`;
  }
  if (frame.kind === "baseline") {
    return `${number} The baseline capture, qualified when the bond was created.`;
  }
  if (frame.kind === "unchanged") {
    return `${number} Admitted, and its digest is identical to the baseline digest.`;
  }
  const reading = frame.reading === "" ? "no reading was recorded" : `read as ${frame.reading.toLowerCase()}`;
  return `${number} Admitted, its digest differs from the baseline, and it ${reading}.`;
}

function Cell({
  frame,
  order,
  selected,
  isCursor,
  onSelect,
}: {
  frame: Frame;
  order: number;
  selected: boolean;
  isCursor: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`hf-cell ${KIND_CLASS[frame.kind]} ${isCursor ? "hf-cell-cursor" : ""}`}
      style={{ ["--frame-order" as string]: Math.min(order, 8) }}
      aria-pressed={selected}
      aria-label={frameName(frame)}
      onClick={onSelect}
    >
      <span className="hf-cell-window">
        {/* A blank frame has no field element at all. Empty glass, not dark glass. */}
        {frame.kind === "blank" ? null : <span className="hf-cell-field" />}
      </span>
      <span className="block">
        <span className="hf-record-sm mt-2 block">{frame.index + 1}</span>
        <span className="hf-record-sm block" style={{ color: "var(--emulsion-72)" }}>
          {frame.tick}
        </span>
        <span className="hf-note strip:hidden mt-1 block">{frame.caption}</span>
      </span>
    </button>
  );
}

export function FrameReel({
  bond,
  points,
}: {
  bond: Pick<Bond, "baseline_digest" | "baseline_timestamp" | "cursor_timestamp" | "url">;
  points: ChangePoint[];
}) {
  const frames = useMemo(() => toFrames(points, baselineOf(bond)), [points, bond]);
  const counts = useMemo(() => tally(frames), [frames]);
  const segments = useMemo(() => stripSegments(frames), [frames]);
  const opening = useMemo(() => lightTableFrame(frames), [frames]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(opening?.index ?? null);
  const [openRuns, setOpenRuns] = useState<Record<number, boolean>>({});

  const selected = frames.find((frame) => frame.index === selectedIndex);

  if (frames.length === 0) {
    return (
      <section aria-labelledby="reel-heading">
        <h2 className="hf-heading" id="reel-heading">
          The reel
        </h2>
        <p className="hf-body mt-3 max-w-[72ch]">
          No capture has been examined yet. The bond carries a qualified baseline, and the reel
          starts at the first check anybody runs.
        </p>
        <p className="hf-note mt-2 max-w-[72ch]">
          An empty reel is not a clean record. It means nothing has been read, which is a different
          fact from a record with nothing wrong in it.
        </p>
      </section>
    );
  }

  /**
   * The ordinal printed on each cell, computed per segment before anything renders.
   *
   * A counter incremented inside the map below would be a render-time mutation of a variable the
   * callback closes over, which is the one shape React's compiler refuses. It reads the same either
   * way: a collapsed run consumes a single ordinal because it draws as a single band, and opening it
   * expands the numbering for every frame after it.
   */
  const startAt: number[] = [];
  let used = 0;
  for (let index = 0; index < segments.length; index += 1) {
    startAt.push(used + 1);
    const segment = segments[index];
    used += segment.kind === "single" || openRuns[index] !== true ? 1 : segment.count;
  }

  return (
    <section aria-labelledby="reel-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="hf-heading" id="reel-heading">
          The reel
        </h2>
        <p className="hf-record-sm">
          {formatCount(counts.total)} examined · {formatCount(counts.admitted)} admitted ·{" "}
          {formatCount(counts.blank)} blank
        </p>
      </div>

      <p className="hf-body mt-3 max-w-[76ch]">{tallySentence(counts)}</p>

      <div className="hf-rail mt-5 hidden strip:block" aria-hidden="true" />

      <div className="mt-3 flex gap-3 strip:mt-0 strip:gap-0">
        <div className="hf-rail-v strip:hidden" aria-hidden="true" />

        <ul
          className="hf-strip-v hf-advancing flex min-w-0 flex-1 list-none flex-col gap-4 p-0 strip:flex-row strip:items-start strip:gap-2 strip:overflow-x-auto strip:py-4"
          aria-label="Archived captures, oldest first"
        >
          {segments.map((segment, segmentIndex) => {
            if (segment.kind === "single") {
              const frame = segment.frame;
              return (
                <li key={`f${frame.index}`} className="min-w-0">
                  <Cell
                    frame={frame}
                    order={startAt[segmentIndex]}
                    selected={frame.index === selectedIndex}
                    isCursor={frame.timestamp === bond.cursor_timestamp}
                    onSelect={() =>
                      setSelectedIndex(frame.index === selectedIndex ? null : frame.index)
                    }
                  />
                </li>
              );
            }

            const open = openRuns[segmentIndex] === true;
            if (open) {
              return (
                <li key={`r${segmentIndex}`} className="min-w-0">
                  <div className="flex min-w-0 flex-col gap-4 strip:flex-row strip:items-start strip:gap-2">
                    {segment.frames.map((frame, frameIndex) => {
                      return (
                        <Cell
                          key={frame.index}
                          frame={frame}
                          order={startAt[segmentIndex] + frameIndex}
                          selected={frame.index === selectedIndex}
                          isCursor={frame.timestamp === bond.cursor_timestamp}
                          onSelect={() =>
                            setSelectedIndex(frame.index === selectedIndex ? null : frame.index)
                          }
                        />
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="hf-btn-quiet mt-3"
                    onClick={() => setOpenRuns((was) => ({ ...was, [segmentIndex]: false }))}
                  >
                    Collapse these {formatCount(segment.count)}
                  </button>
                </li>
              );
            }

            return (
              <li key={`r${segmentIndex}`} className="min-w-0 strip:min-w-[140px] strip:flex-1">
                <div
                  className="hf-run-band w-full"
                  role="img"
                  aria-label={`${formatCount(segment.count)} consecutive captures, each admitted and each hashing to the baseline digest, from ${frameMoment(segment.from)} to ${frameMoment(segment.to)}.`}
                />
                <p className="hf-record-sm mt-2">{segment.label}</p>
                <button
                  type="button"
                  className="hf-btn-quiet mt-2"
                  onClick={() => setOpenRuns((was) => ({ ...was, [segmentIndex]: true }))}
                >
                  Open all {formatCount(segment.count)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="hf-rail mt-2 hidden strip:block" aria-hidden="true" />

      {counts.blank > 0 ? (
        <p className="hf-note mt-5 max-w-[76ch]">
          <span className="hf-record hf-tag hf-tag-open">BLANK</span> {BLANK_FRAME_MEANING}
        </p>
      ) : null}

      {counts.unaccounted > 0 ? (
        <p className="hf-note mt-3 max-w-[76ch]">
          <span className="hf-record hf-tag hf-tag-verdict">UNACCOUNTED</span>{" "}
          {formatCount(counts.unaccounted)} admitted{" "}
          {counts.unaccounted === 1 ? "capture carries" : "captures carry"} no reading. The deployed
          contract cannot produce that shape, so this is reported rather than drawn as an ordinary
          examined capture with nothing found.
        </p>
      ) : null}

      <div className="mt-8">
        {selected ? (
          <LightTable frame={selected} url={bond.url} />
        ) : (
          <div className="border p-5" style={{ borderColor: "var(--rule-strong)" }}>
            <h3 className="hf-heading">The light table</h3>
            <p className="hf-body mt-2 max-w-[72ch]">
              {opening
                ? "Nothing is open. Choose a frame above to read what was recorded about it."
                : "No admitted capture has differed from the baseline digest, so there is no reading to open. Choose any frame above to see what was recorded about it."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * The light table
 * ------------------------------------------------------------------------- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t py-2 strip:grid strip:grid-cols-[190px_1fr] strip:gap-4">
      <dt className="hf-label">{label}</dt>
      <dd className="hf-record mt-1 break-words strip:mt-0">{children}</dd>
    </div>
  );
}

/**
 * One capture, read.
 *
 * `.hf-unfixed` paints only inside `.hf-lighttable`, and the live URL below is the only thing on
 * this panel that carries it. Everything else here was read from an immutable archived frame and is
 * set in diazo, so the two classes of evidence cannot be presented with the same authority. That
 * fell out of the contrast arithmetic: 3.73:1 on the glass fails, 5.21:1 on the light table passes.
 */
function LightTable({ frame, url }: { frame: Frame; url: string }) {
  const point = frame.point;
  const replay = `https://web.archive.org/web/${point.timestamp}/${url}`;
  const reading = frame.reading === "" ? undefined : READING_TEXT[frame.reading];
  const gates = point.failed_gates
    .split(",")
    .map((letter) => letter.trim())
    .filter((letter): letter is "A" | "B" | "C" | "D" => letter in GATE_TEXT);

  return (
    <div className="hf-lighttable hf-open border p-5" style={{ borderColor: "var(--emulsion)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="hf-heading">
          Frame {frame.index + 1} · <span className="hf-diazo">{frameMoment(point.timestamp)}</span>
        </h3>
        <p className="hf-record-sm">{frame.caption}</p>
      </div>

      {point.qualified ? null : (
        <p className="hf-note mt-3 max-w-[74ch]">
          <span className="hf-record hf-tag hf-tag-open">NOT ADMITTED</span> {gatePhrase(point.failed_gates)}.
          Nothing was read from this capture. It is not evidence that the commitment held and it is
          not evidence that it weakened.
        </p>
      )}

      <dl className="mt-4">
        <Row label="Archived frame">
          <a className="hf-diazo underline" href={replay} target="_blank" rel="noreferrer noopener">
            {point.timestamp}
          </a>
          <span className="hf-record-sm ml-2">immutable, and the digest below verifies it</span>
        </Row>
        <Row label="Index digest">
          <span className="hf-diazo">{point.digest}</span>
          <span className="hf-record-sm ml-2">base32 sha1 over the raw payload, before decoding</span>
        </Row>
        <Row label="Raw payload">
          {formatBytes(point.raw_len)}
          <span className="hf-record-sm ml-2">{ENCODING_TEXT[point.encoding]}</span>
        </Row>
        <Row label="Decoded sha256">{point.decoded_sha256}</Row>
        <Row label="Extracted text">
          {formatCount(point.text_len)} characters
          {point.text_truncated ? (
            <span className="hf-record-sm ml-2">
              truncated at the prompt cap before it was measured
            </span>
          ) : null}
          <span className="hf-note mt-1 block">
            Characters of visible text, not decoded bytes. This is never the inflation figure.
          </span>
        </Row>
        <Row label="Gates">
          {point.qualified ? "passed every enabled gate" : gatePhrase(point.failed_gates)}
          <span className="hf-record-sm ml-2">gate C matched {formatCount(point.gate_c_hits)} sections</span>
        </Row>
        {reading ? (
          <Row label="Reading">
            <span className="hf-diazo">{frame.reading}</span>
            <span className="hf-note mt-1 block">{reading.meaning}</span>
            <span className="hf-note mt-1 block">{reading.limit}</span>
          </Row>
        ) : null}
        {point.excerpt ? (
          <Row label="Excerpt">
            <blockquote className="hf-record m-0 border-l-2 pl-3 whitespace-pre-wrap" style={{ borderColor: "var(--diazo)" }}>
              {point.excerpt}
            </blockquote>
            <span className="hf-note mt-1 block">
              Verbatim from the decoded bytes. A finding that cannot be quoted from the document is
              refused before it is recorded.
            </span>
          </Row>
        ) : null}
        {point.rationale ? <Row label="Rationale">{point.rationale}</Row> : null}
        <Row label="Recorded">{displayTime(point.observed_at)}</Row>
        <Row label="The page today">
          <a className="hf-unfixed underline" href={url} target="_blank" rel="noreferrer noopener">
            {url}
          </a>
          <span className="hf-note mt-1 block">
            The live page, which is the one thing on this panel nothing here has verified. It can
            change between this sentence and your click, and no bond is ever settled against it.
          </span>
        </Row>
      </dl>

      {gates.length > 0 ? (
        <div className="mt-5 border-t pt-4">
          <h4 className="hf-label hf-label-ink">What decided</h4>
          <ul className="mt-2 list-none p-0">
            {gates.map((letter) => (
              <li key={letter} className="hf-note mt-2 max-w-[74ch]">
                <span className="hf-record hf-tag">{letter}</span> {GATE_TEXT[letter].label}.{" "}
                {GATE_TEXT[letter].meaning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
