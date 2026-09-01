/**
 * One bond, read in full.
 *
 * Four reads, and the page does not degrade any of them into silence. `commitment_status` is the
 * integration surface a procurement bot would poll, so its tallies are printed here in the same
 * words the contract returns them in rather than being summarized into a single verdict word.
 *
 * The order on the page is deliberate: the sentence that was staked on, then the reel of captures
 * that were read, then what can be done next. Actions come last because every one of them is an
 * argument about the evidence above it.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { BondActions } from "@/components/bond-actions";
import { FrameReel } from "@/components/frame-reel";
import type { Bond, CommitmentStatus } from "@/lib/contract-types";
import {
  BOND_STATE_TEXT,
  CONTEST_OUTCOME_TEXT,
  ENCODING_TEXT,
  sameAddress,
} from "@/lib/contract-types";
import {
  commitmentStatus,
  getBond,
  getBondHistory,
  getLimits,
  readFailureLine,
} from "@/lib/data-source";
import {
  daysBetween,
  displayDay,
  displayTime,
  formatCount,
  formatGen,
  frameMoment,
  shortenHex,
} from "@/lib/format";
import { heldHeadline } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export default async function BondPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [bondRead, historyRead, statusRead, limitsRead] = await Promise.all([
    getBond(id),
    getBondHistory(id),
    commitmentStatus(id),
    getLimits(),
  ]);

  if (bondRead.kind === "NOT_FOUND") notFound();

  if (bondRead.kind !== "AVAILABLE") {
    return (
      <div className="border p-5" style={{ borderColor: "var(--rule-strong)" }}>
        <h1 className="hf-heading">{id}</h1>
        <p className="hf-note mt-3 max-w-[76ch]">{readFailureLine(bondRead, `bond ${id}`)}</p>
        <Link className="hf-btn-quiet mt-4 inline-block no-underline" href="/">
          Back to the bonds
        </Link>
      </div>
    );
  }

  const bond = bondRead.value;
  const history = historyRead.kind === "AVAILABLE" ? historyRead.value : [];
  const limits = limitsRead.kind === "AVAILABLE" ? limitsRead.value : undefined;
  const state = BOND_STATE_TEXT[bond.state];
  const held = heldHeadline(bond.checks_passed, history.length);
  const nowIso = new Date().toISOString();
  const daysLeft = daysBetween(nowIso, bond.expires_at);

  return (
    <div>
      <section aria-labelledby="bond-heading">
        <p className="hf-label">Bond</p>
        <h1 className="hf-display mt-1" id="bond-heading">
          {bond.bond_id}
        </h1>

        <p className="hf-body mt-4 max-w-[80ch]">{held.headline}</p>
        <p className="hf-note mt-2 max-w-[80ch]">{held.limit}</p>

        <div className="mt-5 border p-5" style={{ borderColor: "var(--emulsion)" }}>
          <p className="hf-label hf-label-ink">The commitment</p>
          <blockquote className="hf-body m-0 mt-2 max-w-[76ch] border-l-2 pl-4" style={{ borderColor: "var(--diazo)" }}>
            {bond.commitment}
          </blockquote>
          <p className="hf-record-sm mt-3 break-words">
            sha256 {bond.commitment_sha256}
          </p>
          <p className="hf-note mt-2 max-w-[76ch]">
            Hashed after normalization: lower cased, punctuation dropped, whitespace runs collapsed
            to one space. The hash is what the contract stores; the sentence above is what it stores
            it for.
          </p>
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-4 strip:grid-cols-3">
          <Field label="Page bonded">
            <a
              className="hf-record break-words underline"
              href={bond.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {bond.url}
            </a>
            <span className="hf-note mt-1 block">
              The live page, which decides nothing here. Every reading below is of an archived
              capture of it.
            </span>
          </Field>
          <Field label="Stake">
            <span className="hf-record">{formatGen(bond.stake)}</span>
            <span className="hf-note mt-1 block">
              On deposit in the contract for the whole term. {state.meaning}
            </span>
          </Field>
          <Field label="State">
            <span className="hf-record hf-tag-verdict hf-tag">{bond.state.toLowerCase().replace("_", " ")}</span>
            <span className="hf-note mt-1 block">{state.limit}</span>
          </Field>

          <Field label="Promisor">
            <span className="hf-record">{shortenHex(bond.promisor)}</span>
            <span className="hf-note mt-1 block">
              Staked the value. The only party who can contest a claim against this bond.
            </span>
          </Field>
          <Field label="Payee">
            <span className="hf-record">{shortenHex(bond.payee)}</span>
            <span className="hf-note mt-1 block">
              {sameAddress(bond.payee, bond.promisor)
                ? "The same address as the promisor, which the contract refuses at creation, so this is a read to check."
                : "Receives the stake if a breach is settled. Named at creation and never changed after."}
            </span>
          </Field>
          <Field label="Term">
            <span className="hf-record">{bond.term_days} days</span>
            <span className="hf-note mt-1 block">
              Opened {displayDay(bond.created_at)}, ends {displayDay(bond.expires_at)}
              {daysLeft === undefined
                ? "."
                : daysLeft > 0
                  ? `, ${formatCount(daysLeft)} days from now.`
                  : ", which has passed."}
            </span>
          </Field>
        </dl>

        <dl className="mt-6 grid gap-x-8 gap-y-4 strip:grid-cols-3">
          <Field label="Baseline capture">
            <a
              className="hf-diazo hf-record underline"
              href={`https://web.archive.org/web/${bond.baseline_timestamp}/${bond.url}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {frameMoment(bond.baseline_timestamp)}
            </a>
            <span className="hf-note mt-1 block">
              Qualified before the stake was accepted. Every later capture is compared against this
              one.
            </span>
          </Field>
          <Field label="Baseline digest">
            <span className="hf-diazo hf-record break-words">{bond.baseline_digest}</span>
            <span className="hf-record-sm mt-1 block">{ENCODING_TEXT[bond.baseline_encoding]}</span>
          </Field>
          <Field label="Anchor">
            <span className="hf-record break-words">{bond.anchor}</span>
            <span className="hf-note mt-1 block">
              Derived from the URL, not chosen. The words below it are what a capture must contain
              before it counts as the same document: {bond.anchor_words}, terminating at{" "}
              {bond.anchor_terminal || "no terminal"}.
            </span>
          </Field>
        </dl>
      </section>

      <div className="hf-rail mt-10" aria-hidden="true" />

      <div className="mt-8">
        {historyRead.kind === "AVAILABLE" ? (
          <FrameReel bond={bond} points={history} />
        ) : (
          <section aria-labelledby="reel-heading">
            <h2 className="hf-heading" id="reel-heading">
              The reel
            </h2>
            <p className="hf-note mt-3 max-w-[76ch]">
              {readFailureLine(historyRead, `capture history for ${bond.bond_id}`)}
            </p>
          </section>
        )}
      </div>

      <div className="hf-rail mt-10" aria-hidden="true" />

      <section className="mt-8" aria-labelledby="status-heading">
        <h2 className="hf-heading" id="status-heading">
          The tally, as an integrator reads it
        </h2>
        {statusRead.kind === "AVAILABLE" ? (
          <StatusTally status={statusRead.value} />
        ) : (
          <p className="hf-note mt-3 max-w-[76ch]">
            {readFailureLine(statusRead, `status for ${bond.bond_id}`)}
          </p>
        )}
      </section>

      {bond.state === "BREACH_CLAIMED" ||
      bond.state === "CONTESTED" ||
      bond.state === "BREACHED" ? (
        <>
          <div className="hf-rail mt-10" aria-hidden="true" />
          <ClaimPanel bond={bond} />
        </>
      ) : null}

      {bond.settled ? (
        <>
          <div className="hf-rail mt-10" aria-hidden="true" />
          <SettlementPanel bond={bond} />
        </>
      ) : null}

      <div className="hf-rail mt-10" aria-hidden="true" />

      <div className="mt-8">
        <BondActions bond={bond} limits={limits} nowIso={nowIso} />
        {limitsRead.kind === "AVAILABLE" ? null : (
          <p className="hf-note mt-4 max-w-[76ch]">
            {readFailureLine(limitsRead, "contract limits")} The buttons above are therefore bounded
            by the client mirror of those limits, which is stated beside them.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="hf-label">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

/**
 * `commitment_status`, printed as counts rather than collapsed into one word.
 *
 * `examined` is not `qualified` and `gate_rejected` is neither. A reader who only saw a verdict
 * would have no way to tell a page that held from a page nothing could be read from, and those two
 * are the whole point of the product.
 */
function StatusTally({ status }: { status: CommitmentStatus }) {
  const rows: Array<[string, string, string]> = [
    ["Examined", status.examined, "Captures the contract fetched, verified against the index digest, and decoded."],
    ["Admitted", status.qualified, "Of those, the ones that passed every enabled gate and were read."],
    ["Not admitted", status.gate_rejected, "Arrived intact and were refused as evidence. Nothing was read from them, in either direction."],
    ["Read as holding", status.holds, "The archived text carried a commitment at least as strong as the bonded one."],
    ["Read as weakened", status.weakened, "The archived text carried a materially weaker commitment, quoted from the capture."],
    ["Read as absent", status.absent, "The archived text carried no commitment on the subject at all."],
    ["Indeterminate", status.indeterminate, "The reading did not resolve. Not a finding and not a clearance."],
  ];

  return (
    <>
      <p className="hf-body mt-3 max-w-[80ch]">
        A breach needs {formatCount(status.breach_run_needed)} consecutive captures read as weakened
        or absent. This bond&apos;s current run is {formatCount(status.run_length)}. One capture is
        never enough, because one capture can be a bad archive day.
      </p>

      <dl className="mt-5">
        {rows.map(([label, value, note]) => (
          <div key={label} className="border-t py-3 strip:grid strip:grid-cols-[200px_100px_1fr] strip:gap-4">
            <dt className="hf-label">{label}</dt>
            <dd className="hf-record mt-1 strip:mt-0">{formatCount(value)}</dd>
            <dd className="hf-note mt-1 max-w-[70ch] strip:mt-0">{note}</dd>
          </div>
        ))}
      </dl>

      <p className="hf-record-sm mt-4">
        last checked {status.last_checked_at ? displayTime(status.last_checked_at) : "never"} · reel
        reaches {status.cursor_timestamp ? frameMoment(status.cursor_timestamp) : "the baseline only"}{" "}
        · last admitted capture{" "}
        {status.last_qualified_timestamp ? frameMoment(status.last_qualified_timestamp) : "none yet"}
      </p>
    </>
  );
}

/** The claim, with both captures it rests on and the clause it was quoted from. */
function ClaimPanel({ bond }: { bond: Bond }) {
  return (
    <section className="mt-8" aria-labelledby="claim-heading">
      <h2 className="hf-heading" id="claim-heading">
        The claim against this bond
      </h2>
      <p className="hf-body mt-3 max-w-[80ch]">
        Two consecutive admitted captures were read as weakened or absent. Both are named, so the
        claim can be checked by opening them rather than by trusting this page.
      </p>

      <dl className="mt-5">
        <ClaimRow label="First capture">
          <a
            className="hf-diazo hf-record underline"
            href={`https://web.archive.org/web/${bond.breach_first_timestamp}/${bond.url}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {frameMoment(bond.breach_first_timestamp)}
          </a>
          <span className="hf-record-sm ml-2 break-words">{bond.breach_first_digest}</span>
        </ClaimRow>
        <ClaimRow label="Second capture">
          <a
            className="hf-diazo hf-record underline"
            href={`https://web.archive.org/web/${bond.breach_second_timestamp}/${bond.url}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {frameMoment(bond.breach_second_timestamp)}
          </a>
          <span className="hf-record-sm ml-2 break-words">{bond.breach_second_digest}</span>
        </ClaimRow>
        {bond.breach_excerpt ? (
          <ClaimRow label="Quoted from the capture">
            <blockquote className="hf-record m-0 border-l-2 pl-3 whitespace-pre-wrap" style={{ borderColor: "var(--diazo)" }}>
              {bond.breach_excerpt}
            </blockquote>
          </ClaimRow>
        ) : null}
        {bond.breach_rationale ? (
          <ClaimRow label="Rationale">
            <span className="hf-note">{bond.breach_rationale}</span>
          </ClaimRow>
        ) : null}
        <ClaimRow label="Claimed">
          <span className="hf-record">{displayTime(bond.claimed_at)}</span>
        </ClaimRow>
        <ClaimRow label="Contest window closes">
          <span className="hf-record">{displayTime(bond.contest_deadline)}</span>
          <span className="hf-note mt-1 block">
            Until then only the promisor can act, by citing a capture that carries the commitment.
            After it, anyone can settle.
          </span>
        </ClaimRow>
        {bond.contest_url ? (
          <ClaimRow label="Capture cited by the promisor">
            <a
              className="hf-diazo hf-record break-words underline"
              href={`https://web.archive.org/web/${bond.contest_timestamp}/${bond.contest_url}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {frameMoment(bond.contest_timestamp)}
            </a>
            <span className="hf-note mt-1 block break-words">{bond.contest_url}</span>
            <span className="hf-record-sm mt-1 block">
              contest bond {formatGen(bond.contest_bond)}, filed {displayTime(bond.contested_at)}
            </span>
          </ClaimRow>
        ) : null}
        {bond.contest_outcome !== "" ? (
          <ClaimRow label="Contest outcome">
            <span className="hf-record hf-tag hf-tag-verdict">{bond.contest_outcome.toLowerCase()}</span>
            <span className="hf-note mt-1 block">
              {CONTEST_OUTCOME_TEXT[bond.contest_outcome].meaning}
            </span>
            <span className="hf-note mt-1 block">
              {CONTEST_OUTCOME_TEXT[bond.contest_outcome].limit}
            </span>
          </ClaimRow>
        ) : null}
      </dl>
    </section>
  );
}

function ClaimRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t py-3 strip:grid strip:grid-cols-[220px_1fr] strip:gap-4">
      <dt className="hf-label">{label}</dt>
      <dd className="mt-1 break-words strip:mt-0">{children}</dd>
    </div>
  );
}

/** Where the money went, from the contract's own two fields rather than from the state name. */
function SettlementPanel({ bond }: { bond: Bond }) {
  return (
    <section className="mt-8" aria-labelledby="settlement-heading">
      <h2 className="hf-heading" id="settlement-heading">
        Settlement
      </h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 strip:grid-cols-3">
        <Field label="Paid to the payee">
          <span className="hf-record">{formatGen(bond.paid_to_payee)}</span>
        </Field>
        <Field label="Returned to the promisor">
          <span className="hf-record">{formatGen(bond.returned_to_promisor)}</span>
        </Field>
        <Field label="Settled">
          <span className="hf-record">{displayTime(bond.settled_at)}</span>
        </Field>
      </dl>
      <p className="hf-note mt-4 max-w-[80ch]">
        Both figures come from the bond record rather than being inferred from its state, because the
        two can differ: an upheld contest returns the stake and the contest bond to the promisor
        while the bond&apos;s state still records that a claim was made against it.
      </p>
    </section>
  );
}
