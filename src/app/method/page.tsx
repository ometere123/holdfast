/**
 * How this contract decides, including the parts of it that are weaker than they look.
 *
 * Three things on this page are unusual for a project page and all three are deliberate.
 *
 * The first is that every method prints its program of work with each step labelled arithmetic,
 * fetch or reading. The boundary between counted bytes and read meaning is the only thing that makes
 * a verdict from this contract worth anything, so it is on the screen rather than in a paragraph.
 *
 * The second is the decoding section. It is the whole reason this project exists and it reads like a
 * bug report because it is one.
 *
 * The third is that this page publishes two claims the project withdrew, both as withdrawn. An
 * earlier build claimed gates B, C and D each caught four of four known-bad snapshots. That number
 * came from a measuring script that fell into the exact trap the gates are supposed to guard against.
 * The second withdrawal is the measurement table below: its decoded byte counts were real and were
 * attributed to the wrong pages, and eighteen passing tests never noticed because not one of them
 * opened a capture. Deleting either quietly would have left the strongest evidence in the project
 * unstated.
 */

import Link from "next/link";
import { GATE_TEXT, limitsDrift } from "@/lib/contract-types";
import {
  DECODE_BRANCHES,
  GATE_A_EVIDENCE,
  GATE_MEASUREMENT,
  GZIP_EVIDENCE,
  NO_RAW_DEFLATE_BRANCH,
  SYNTHETIC_NEGATIVE,
  TABLE_CORRECTION,
} from "@/lib/archive-evidence";
import { dataProvenance, getLimits, readFailureLine } from "@/lib/data-source";
import { formatBytes, formatCount } from "@/lib/format";
import { BLANK_FRAME_MEANING, OUTCOMES } from "@/lib/lifecycle";
import { ProgramTable } from "@/components/program-table";

export const dynamic = "force-dynamic";

/** The six methods, in the order a bond meets them, with the caller each one is open to. */
const METHODS: Array<{ name: string; heading: string; caller: string }> = [
  { name: "create_bond", heading: "Bonding a page", caller: "the promisor, who becomes the caller" },
  { name: "check_commitment", heading: "Checking the archive", caller: "anyone" },
  { name: "contest_breach", heading: "Filing a contest", caller: "the promisor only" },
  { name: "adjudicate_contest", heading: "Adjudicating a filed contest", caller: "anyone" },
  { name: "settle_breach", heading: "Settling a claim the window closed on", caller: "anyone" },
  { name: "expire_bond", heading: "Returning a stake at term", caller: "anyone" },
];

const TAG_ORDER = ["expected", "external", "transient", "llm-error"] as const;

export default async function MethodPage() {
  const limitsRead = await getLimits();
  const limits = limitsRead.kind === "AVAILABLE" ? limitsRead.value : undefined;
  const drift = limits ? limitsDrift(limits) : [];
  const provenance = dataProvenance();
  const gateAOn = limits ? limits.gate_a_enabled : false;

  return (
    <div>
      <p className="hf-label">Method</p>
      <h1 className="hf-display mt-1">What the contract does, step by step</h1>

      <p className="hf-body mt-4 max-w-[80ch]">
        A bond here is staked on a sentence somebody published, and it is settled against the
        Internet Archive&apos;s record of the page that sentence appeared on. The live page is never
        the evidence. It can be edited, redirected or taken down after the stake is posted, and none
        of that changes what the archive already holds.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        Every fetch below happens inside consensus, so each validator retrieves the capture itself
        and the digest has to agree across all of them before any of it counts. A capture that
        cannot be retrieved is never reported as an intact commitment and never as a broken one.
      </p>

      {/* --------------------------------------------------------------- *
       * The six programs of work
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-10" />
      <h2 className="hf-heading mt-6">The six calls</h2>
      <p className="hf-body mt-3 max-w-[80ch]">
        Four of the six are callable by a stranger. That is the product and not a permission setting:
        nobody has to stay available for a commitment to be checked, and the one call reserved to the
        promisor is their defence rather than their obligation.
      </p>

      {METHODS.map((method) => (
        <section key={method.name} className="mt-8">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 className="hf-heading">{method.heading}</h3>
            <span className="hf-record-sm">{method.name}</span>
            <span className="hf-record hf-tag">{method.caller}</span>
          </div>
          <div className="mt-3">
            <ProgramTable functionName={method.name} heading="Program of work" />
          </div>
        </section>
      ))}

      <div className="mt-8 border p-4" style={{ borderColor: "var(--diazo)" }}>
        <p className="hf-label hf-label-ink">Why create_bond refunds instead of reverting</p>
        <p className="hf-note mt-2 max-w-[76ch]">
          A payable method on this network cannot refuse a call by reverting without keeping the
          money. Storage rolls back on a revert; the transfer that funded the call does not. This
          contract reverted anyway at first, on an argument that sounded sufficient: every check in{" "}
          <span className="hf-record">create_bond</span> is deterministic and runs before the first
          network call, so a caller can simulate the same call with no value attached and learn the
          answer for free. The value check is deliberately the last of them (Holdfast.py:2593), which
          is what lets that simulation reach every other refusal first.
        </p>
        <p className="hf-note mt-2 max-w-[76ch]">
          The argument was true and insufficient, and a funded transaction is what showed it. A
          quarter of a GEN went into <span className="hf-record">create_bond</span>, reached a
          refusal on the far side of the first network call where no simulation can go, and did not
          come back. Both payable methods are now refusal boundaries (Holdfast.py:2506): they refund
          the value and return the tagged sentence instead of raising it. The sentence is unchanged,
          tag and all, and only the delivery is different. The dry run is still here and still worth
          running, because the bond id and the url-and-commitment pair are checked against contract
          state no browser holds, but it is a convenience now rather than the thing standing between a
          typo and a lost stake.
        </p>
        <p className="hf-note mt-2 max-w-[76ch]">
          One consequence is worth saying plainly, because it is the sort of thing a reader assumes
          the other way. A refused call still finalizes as a successful transaction. That the
          transaction succeeded and that the request was accepted are two different facts, so
          everything in this app reads the tag on the returned sentence rather than the status on the
          receipt.
        </p>
      </div>

      {/* --------------------------------------------------------------- *
       * Decoding
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-12" />
      <h2 className="hf-heading mt-6">The bytes the archive actually returns</h2>

      <p className="hf-body mt-3 max-w-[80ch]">
        The Wayback <span className="hf-record">id_</span> replay hands back the archived response
        verbatim, headers stripped. A page served gzipped in 2019 replays as gzip in 2026. Those
        compressed bytes are byte-identical for every validator, which is the trap: a contract that
        skips decompression reaches unanimous agreement on binary noise and reports it as a reading
        of the document.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        All seven real captures taken for this project, in the order they were archived. The eighth
        payload on disk was built by hand and is held out of this table. Each row names the file it was
        measured from, and the tests re-derive the two byte counts and the encoding from those bytes.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        The last two columns are what a build that skipped decompression would have had to work from.
        The character counts are not zero, and that is the finding: compressed bytes put through a
        lenient decode yield tens of thousands of characters, so an emptiness check passes, a length
        check passes, and the document reads as saying nothing. The zero that carries the argument is
        the section count.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="hf-label border-b py-2 pr-4">Page</th>
              <th className="hf-label border-b py-2 pr-4">Capture</th>
              <th className="hf-label border-b py-2 pr-4">Replayed</th>
              <th className="hf-label border-b py-2 pr-4">Decoded</th>
              <th className="hf-label border-b py-2 pr-4">Encoding</th>
              <th className="hf-label border-b py-2 pr-4">Chars undecoded</th>
              <th className="hf-label border-b py-2">Sections undecoded</th>
            </tr>
          </thead>
          <tbody>
            {GZIP_EVIDENCE.map((row) => (
              <tr key={row.fixture}>
                <td className="hf-record-sm border-t py-2 pr-4">{row.page}</td>
                <td className="hf-record-sm border-t py-2 pr-4">{row.timestamp}</td>
                <td className="hf-record-sm border-t py-2 pr-4">{formatBytes(row.raw)}</td>
                <td className="hf-record-sm border-t py-2 pr-4">{formatBytes(row.decoded)}</td>
                <td className="hf-record-sm border-t py-2 pr-4">{row.encoding}</td>
                <td className="hf-record-sm border-t py-2 pr-4">{formatCount(row.undecodedChars)}</td>
                <td className="hf-record-sm border-t py-2">{row.sectionsUndecoded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hf-note mt-4 max-w-[80ch]">
        The two uncompressed rows are the control, and they are the same pages as compressed rows
        rather than a different site. <span className="hf-record">openai.com/policies/terms-of-use</span>{" "}
        was archived uncompressed in 2024 and compressed in 2026, so the identity branch is measured
        rather than assumed.
      </p>

      <h3 className="hf-heading mt-8">Three branches, and no fourth</h3>
      <p className="hf-note mt-2 max-w-[80ch]">
        <span className="hf-record">decode_payload</span> dispatches on the first bytes
        (Holdfast.py:847). Six of the eight payloads captured for this project begin{" "}
        <span className="hf-record">1f8b</span> and two begin <span className="hf-record">3c21</span>,
        an uncompressed doctype.
      </p>

      <ul className="mt-4 list-none p-0">
        {DECODE_BRANCHES.map((branch) => (
          <li key={branch.magic} className="border-t py-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="hf-record">{branch.magic}</span>
              <span className="hf-body">{branch.branch}</span>
            </div>
            <p className="hf-note mt-1 max-w-[76ch]">{branch.note}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
        <p className="hf-label hf-label-ink">Why there is no raw deflate branch</p>
        <p className="hf-note mt-2 max-w-[76ch]">
          A raw-deflate attempt looks like the obvious fourth case and it is left out on purpose
          (Holdfast.py:854). Both non-deflate shapes that were actually tried do not raise under a
          negative window. They succeed and return a plausible near-empty document, which every
          validator would then agree on. The omission is structural rather than merely intended: the
          negative window constant such a branch would need is deliberately never defined
          (Holdfast.py:812).
        </p>
        <ul className="mt-3 list-none p-0">
          {NO_RAW_DEFLATE_BRANCH.map((shape) => (
            <li key={shape.input} className="hf-record-sm mt-2 max-w-[76ch]">
              {shape.input}: {shape.result}
            </li>
          ))}
        </ul>
        <p className="hf-note mt-3 max-w-[76ch]">
          A branch that cannot fail loudly is worse than a missing branch that fails closed.
        </p>
      </div>

      {limits ? (
        <p className="hf-record-sm mt-6 max-w-[80ch]">
          Caps in force on this deployment: index length {formatBytes(limits.cdx_warc_length_max)},
          replayed payload {formatBytes(limits.raw_max_bytes)}, decoded text{" "}
          {formatBytes(limits.decoded_max_bytes)}. A payload over its cap is a transient failure
          rather than a truncated reading.
        </p>
      ) : null}

      {/* --------------------------------------------------------------- *
       * Gates
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-12" />
      <h2 className="hf-heading mt-6">Admitting a capture, before reading it</h2>

      <p className="hf-body mt-3 max-w-[80ch]">
        Decoding proves the bytes are a document. It does not prove they are the document. Four gates
        stand between a decoded capture and a reading, and a capture that fails one is recorded as a
        blank frame: present in the history, counted as a skip, never counted as the commitment
        weakening.
      </p>

      <ul className="mt-5 list-none p-0">
        {(Object.keys(GATE_TEXT) as Array<keyof typeof GATE_TEXT>).map((key) => {
          const gate = GATE_TEXT[key];
          const enabled = key === "A" ? gateAOn : true;
          return (
            <li key={key} className="border-t py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="hf-record">Gate {key}</span>
                <span className="hf-body">{gate.label}</span>
                <span className={enabled ? "hf-record hf-tag" : "hf-record hf-tag hf-tag-open"}>
                  {enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <p className="hf-note mt-1 max-w-[78ch]">{gate.meaning}</p>
            </li>
          );
        })}
      </ul>

      <p className="hf-record-sm mt-4 max-w-[80ch]">
        {limits
          ? `Read from get_limits: gate A is ${gateAOn ? "on" : "off"} on this deployment.`
          : "Gate A state could not be read, so it is shown as off, which is the shipped default."}{" "}
        Gate D&apos;s marker is forced to be independent of the anchor and of every section
        (Holdfast.py:1210), because a gate that can only fail when another gate already failed is not
        a gate.
      </p>

      <div className="mt-6 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
        <p className="hf-label hf-label-ink">Why gate A ships disabled</p>
        <p className="hf-note mt-2 max-w-[76ch]">
          This is the one gate decision with a measurement behind it.{" "}
          <span className="hf-record">{GATE_A_EVIDENCE.page}</span> extracted{" "}
          {formatCount(GATE_A_EVIDENCE.fromChars)} characters in one capture and{" "}
          {formatCount(GATE_A_EVIDENCE.toChars)} in another, with no change to the policy in between.
          Navigation chrome accounted for all of it. A length-against-median gate would have blanked a
          faithful capture, so <span className="hf-record">GATE_A_ENABLED_DEFAULT</span> is False
          (Holdfast.py:1153) and the contract publishes that it is off rather than leaving the
          interface to assume.
        </p>
      </div>

      {/* --------------------------------------------------------------- *
       * The withdrawn measurement
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-12" />
      <h2 className="hf-heading mt-6">Two claims this project withdrew</h2>

      <p className="hf-body mt-3 max-w-[80ch]">
        Both were numbers that agreed with the numbers around them and were never tied back to the
        thing they described. The first is about the gates. The second is about the measurement table
        further up this page, and it is the worse of the two.
      </p>

      <div className="mt-4 border p-4" style={{ borderColor: "var(--diazo)" }}>
        <p className="hf-body">
          <span className="hf-record hf-tag hf-tag-open">WITHDRAWN</span>{" "}
          {GATE_MEASUREMENT.withdrawnClaim}
        </p>
        <dl className="mt-4">
          <dt className="hf-label hf-label-ink">Cause</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{GATE_MEASUREMENT.cause}</dd>
          <dt className="hf-label hf-label-ink mt-3">The tell, which was in the result itself</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{GATE_MEASUREMENT.tell}</dd>
          <dt className="hf-label hf-label-ink mt-3">What the gates can be said to be</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{GATE_MEASUREMENT.standing}</dd>
        </dl>
        <p className="hf-record-sm mt-4">
          Captured payloads that qualify once decoded: {GATE_MEASUREMENT.trueNegatives}. Measured true
          positives for gates B, C and D: {GATE_MEASUREMENT.truePositives}.
        </p>
        <p className="hf-note mt-3 max-w-[76ch]">
          The finding is on this page rather than deleted from it, because it is the strongest
          evidence in the project for the thing the project is about. The trap caught the research
          script written to study the trap.
        </p>
      </div>

      <h3 className="hf-heading mt-8">The one capture that shows the gates doing separate work</h3>
      <p className="hf-note mt-2 max-w-[80ch]">
        Built by taking a real gzip replay and stripping everything but the page chrome:{" "}
        <span className="hf-record">{SYNTHETIC_NEGATIVE.file}</span>, magic{" "}
        <span className="hf-record">{SYNTHETIC_NEGATIVE.magic}</span>,{" "}
        {formatBytes(SYNTHETIC_NEGATIVE.decodedBytes)} decoded. {SYNTHETIC_NEGATIVE.result}
      </p>
      <p className="hf-note mt-2 max-w-[80ch]">
        {SYNTHETIC_NEGATIVE.standing} It is the only evidence here that B, C and D are not three
        spellings of one test, and it is said to be synthetic every time it is cited.
      </p>

      <h3 className="hf-heading mt-8">The second withdrawal: the table on this page</h3>

      <div className="mt-4 border p-4" style={{ borderColor: "var(--diazo)" }}>
        <p className="hf-body">
          <span className="hf-record hf-tag hf-tag-open">WITHDRAWN</span>{" "}
          {TABLE_CORRECTION.withdrawnClaim}
        </p>
        <dl className="mt-4">
          <dt className="hf-label hf-label-ink">Cause</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{TABLE_CORRECTION.cause}</dd>
          <dt className="hf-label hf-label-ink mt-3">The tell, which was two claims contradicting</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{TABLE_CORRECTION.tell}</dd>
          <dt className="hf-label hf-label-ink mt-3">What the table is now</dt>
          <dd className="hf-note mt-1 max-w-[76ch]">{TABLE_CORRECTION.standing}</dd>
        </dl>
        <p className="hf-record-sm mt-4">
          Tests that passed on the wrong table: {TABLE_CORRECTION.testsThatPassedOnTheWrongTable}.
        </p>
        <p className="hf-note mt-3 max-w-[76ch]">
          Every one of those tests checked the numbers against each other: that decoded exceeded raw,
          that the inflation ratio was plausible, that the largest value was the one named in the
          prose. Not one of them opened a capture. A table of measurements whose rows have been
          recombined satisfies every internal-consistency check a correct table satisfies, so the only
          test that can catch it is one that reads the artefact. The tests behind the table above now
          read all eight payloads off disk and re-derive both byte counts and the encoding from the
          bytes, and every row names the file it came from.
        </p>
      </div>

      {/* --------------------------------------------------------------- *
       * Runs and the error taxonomy
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-12" />
      <h2 className="hf-heading mt-6">What counts as a breach, and what a failure means</h2>

      <p className="hf-body mt-3 max-w-[80ch]">
        A claim needs {limits ? formatCount(limits.breach_run_length) : "2"} consecutive qualified
        captures reading as weaker or silent (Holdfast.py:1715), and a bond cannot be checked at all
        until the archive holds at least {limits ? formatCount(limits.min_change_points) : "3"} change
        points for its URL (Holdfast.py:679). One bad capture is not a breach, and a page the archive
        barely covers is not a page this contract will judge.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        Four failure tags are declared in one place (Holdfast.py:1694). Only the first of them is a
        verdict. The other three mean the contract declined to turn a problem with the evidence into
        a statement about the commitment, and none of them writes anything either way. What differs
        is the delivery. On the four calls that carry no value the whole call reverts. On the two
        payable ones the value is refunded and the same tagged sentence comes back as the return
        value, because a revert on a payable method would keep money it had just declined to work
        for.
      </p>

      <ul className="mt-5 list-none p-0">
        {TAG_ORDER.map((key) => {
          const outcome = OUTCOMES[key];
          return (
            <li key={key} className="border-t py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="hf-record hf-tag hf-tag-verdict">{outcome.tag}</span>
                <span className="hf-body">{outcome.headline}</span>
                <span className="hf-record-sm">
                  {outcome.retry ? "sending again is the expected step" : "nothing to retry"}
                </span>
              </div>
              <p className="hf-note mt-1 max-w-[78ch]">{outcome.body}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
        <p className="hf-label hf-label-ink">The blank frame</p>
        <p className="hf-note mt-2 max-w-[76ch]">{BLANK_FRAME_MEANING}</p>
        <p className="hf-note mt-2 max-w-[76ch]">
          It is worth separating from the four tags above because it is the opposite case: those four
          record nothing at all, so the reel has no frame for them and stops. A blank frame is a call
          that succeeded and wrote down that a capture arrived, verified against the index, and was
          not the document it claimed to be.
        </p>
      </div>

      {/* --------------------------------------------------------------- *
       * Bounds
       * --------------------------------------------------------------- */}

      <div className="hf-rule-strong mt-12" />
      <h2 className="hf-heading mt-6">Where the numbers on this site come from</h2>

      {limitsRead.kind === "AVAILABLE" ? (
        <p className="hf-body mt-3 max-w-[80ch]">
          {provenance.mode === "live"
            ? "Every bound printed anywhere in this interface was read from get_limits() on the deployed contract at page load. None of them is hardcoded in a form."
            : "This build is running on fixtures, so the bounds printed here are the fixture set rather than a deployed contract's. In live mode the same fields come from get_limits() and nothing in a form supplies its own."}
        </p>
      ) : (
        <p className="hf-body mt-3 max-w-[80ch]">
          {readFailureLine(limitsRead, "contract limits")} The forms fall back to this build&apos;s
          mirror of those bounds, which is the safe direction only because the mirror is checked
          against the contract whenever the contract answers.
        </p>
      )}

      {drift.length > 0 ? (
        <div className="mt-4 border p-4" style={{ borderColor: "var(--diazo)" }}>
          <p className="hf-label hf-label-ink">
            {drift.length === 1 ? "One bound" : `${drift.length} bounds`} where this build and the
            contract disagree
          </p>
          <ul className="mt-2 list-none p-0">
            {drift.map((item) => (
              <li key={item.field} className="hf-record-sm mt-1">
                {item.field}: this build says {item.client}, the contract says {item.contract}
              </li>
            ))}
          </ul>
          <p className="hf-note mt-2 max-w-[76ch]">
            Drift is a bug in this build rather than in the contract, and it is printed instead of
            being resolved silently.
          </p>
        </div>
      ) : limits ? (
        <p className="hf-record-sm mt-4">
          The client mirror agrees with the contract on every bound it mirrors.
        </p>
      ) : null}

      <div className="hf-rail mt-10" aria-hidden="true" />

      <p className="hf-note mt-6 max-w-[80ch]">
        The place to see all of this on one bond is a bond page:{" "}
        <Link className="underline" href="/">
          the list
        </Link>{" "}
        prints every stake the contract holds, and{" "}
        <Link className="underline" href="/create">
          bonding a page
        </Link>{" "}
        runs the whole deterministic half of create_bond in the browser before a wallet opens.
      </p>
    </div>
  );
}
