/**
 * The index: what the contract is holding, and every bond it holds it for.
 *
 * `export const dynamic` is not boilerplate here. Next 16 prerenders a route like this one at build
 * time by default, which freezes contract reads into the bundle: the page would show whatever the
 * chain said the day it was built and keep showing it. A sibling project shipped exactly that.
 *
 * Three reads, and each of the four `ReadResult` kinds is drawn differently. A bond list that could
 * not be fetched is never rendered as a bond list with nothing in it, because one of those is a
 * network fault and the other reads on screen as a system with nothing wrong.
 */

import Link from "next/link";
import type { BondSummary } from "@/lib/contract-types";
import { BOND_STATE_TEXT } from "@/lib/contract-types";
import { countBonds, getLedger, getLimits, listBonds, readFailureLine } from "@/lib/data-source";
import { displayDay, formatCount, formatGen, frameMoment } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BondsPage() {
  const [bonds, ledger, limits] = await Promise.all([listBonds(), getLedger(), getLimits()]);

  const rows = bonds.kind === "AVAILABLE" ? bonds.value : [];
  const counts = countBonds(rows);

  const held =
    ledger.kind === "AVAILABLE"
      ? (() => {
          try {
            return (
              BigInt(ledger.value.total_escrowed) -
              BigInt(ledger.value.total_paid_to_payees) -
              BigInt(ledger.value.total_returned_to_promisors)
            );
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const checkHours = limits.kind === "AVAILABLE" ? Number(limits.value.check_interval_seconds) / 3600 : undefined;

  return (
    <div>
      <section aria-labelledby="ledger-heading">
        <h1 className="hf-heading" id="ledger-heading">
          What the contract is holding
        </h1>

        {ledger.kind === "AVAILABLE" ? (
          <>
            <dl className="mt-4 grid gap-x-8 gap-y-4 strip:grid-cols-4">
              <Figure
                label="Held in escrow"
                value={held === undefined ? "unreadable" : formatGen(held)}
                note="Escrowed less both payouts. Cumulative totals, so this is what is still on deposit."
              />
              <Figure
                label="Paid to payees"
                value={formatGen(ledger.value.total_paid_to_payees)}
                note="Stakes that went to a named beneficiary after a breach was settled."
              />
              <Figure
                label="Returned to promisors"
                value={formatGen(ledger.value.total_returned_to_promisors)}
                note="Stakes returned at term, or after a contest was upheld."
              />
              <Figure
                label="Checks run"
                value={formatCount(ledger.value.checks_run)}
                note={
                  checkHours === undefined
                    ? "Every one of them triggerable by anyone."
                    : `Every one of them triggerable by anyone, no more than once every ${checkHours} hours per bond.`
                }
              />
            </dl>

            <p className="hf-note mt-4 max-w-[80ch]">
              {formatCount(ledger.value.bonds_created)} bonds created,{" "}
              {formatCount(ledger.value.breaches_claimed)} breaches claimed,{" "}
              {formatCount(ledger.value.contests_filed)} contests filed. The protocol fee is{" "}
              {Number(ledger.value.fee_basis_points) / 100}% of a settled stake and it is taken at
              settlement, not at creation, so opening a bond costs the gas and nothing else.
            </p>
          </>
        ) : (
          <p className="hf-note mt-4 max-w-[80ch]">{readFailureLine(ledger, "ledger")}</p>
        )}
      </section>

      <div className="hf-rail mt-8" aria-hidden="true" />

      <section className="mt-8" aria-labelledby="bonds-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="hf-heading" id="bonds-heading">
            Bonds
          </h2>
          {bonds.kind === "AVAILABLE" ? (
            <p className="hf-record-sm">
              {formatCount(counts.total)} total · {formatCount(counts.active)} active ·{" "}
              {formatCount(counts.claimed)} claimed · {formatCount(counts.contested)} contested ·{" "}
              {formatCount(counts.breached)} breached · {formatCount(counts.returned)} returned
            </p>
          ) : null}
        </div>

        {bonds.kind !== "AVAILABLE" ? (
          <p className="hf-note mt-4 max-w-[80ch]">{readFailureLine(bonds, "bond list")}</p>
        ) : rows.length === 0 ? (
          <div className="mt-5 border p-5" style={{ borderColor: "var(--rule-strong)" }}>
            <p className="hf-body max-w-[74ch]">
              The contract holds no bonds yet. This is a read that succeeded and found nothing, which
              is a different fact from a read that failed.
            </p>
            <Link className="hf-btn-diazo mt-4 inline-block no-underline" href="/create">
              Bond a page
            </Link>
          </div>
        ) : (
          <ul className="mt-2 list-none p-0">
            {rows.map((bond) => (
              <BondRow key={bond.bond_id} bond={bond} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="premise-heading">
        <div className="hf-rail" aria-hidden="true" />
        <h2 className="hf-heading mt-6" id="premise-heading">
          What is being checked, and against what
        </h2>
        <p className="hf-body mt-3 max-w-[80ch]">
          A promisor stakes value on a sentence they published, on a page they name. Anyone can then
          ask the contract to read that page as the Internet Archive recorded it, one capture at a
          time, and record what the archived text says about the sentence. The live page is never the
          evidence. An archived capture carries a digest the archive publishes and the contract
          verifies, so the bytes every validator reads are the same bytes.
        </p>
        <p className="hf-note mt-3 max-w-[80ch]">
          Nothing here reads the live web to decide anything, and an archive that does not answer is
          never reported as a commitment intact or a commitment broken. Both of those are on the
          method page, with the byte counts behind them.
        </p>
        <Link className="hf-btn-quiet mt-4 inline-block no-underline" href="/method">
          How a check works
        </Link>
      </section>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="hf-label">{label}</dt>
      <dd className="mt-1">
        <span className="hf-record block">{value}</span>
        <span className="hf-note mt-1 block">{note}</span>
      </dd>
    </div>
  );
}

/**
 * One row, built on the eight fields `list_bonds` returns and not on a whole bond.
 *
 * A breach excerpt is deliberately unreachable from here. A quoted clause with no capture beside it
 * is the shape of an accusation rather than a reading, so it only appears on the detail page under
 * the frame it was quoted from.
 */
function BondRow({ bond }: { bond: BondSummary }) {
  const state = BOND_STATE_TEXT[bond.state];
  return (
    <li className="border-t py-4">
      <div className="flex flex-col gap-3 strip:flex-row strip:items-baseline strip:justify-between strip:gap-6">
        <div className="min-w-0">
          <Link className="hf-body no-underline" href={`/bonds/${bond.bond_id}`}>
            <span className="hf-record">{bond.bond_id}</span>
          </Link>
          <p className="hf-note mt-1 max-w-[70ch] break-words">{bond.url}</p>
          <p className="hf-note mt-1 max-w-[70ch]">{state.meaning}</p>
        </div>

        <div className="shrink-0 strip:text-right">
          <p className="hf-record">{formatGen(bond.stake)}</p>
          <p className="hf-record-sm mt-1">
            <span className="hf-tag">{bond.state.toLowerCase().replace("_", " ")}</span>
          </p>
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 strip:grid-cols-4">
        <Small label="Checks passed" value={formatCount(bond.checks_passed)} />
        <Small label="Captures examined" value={formatCount(bond.points_recorded)} />
        <Small
          label="Reel reaches"
          value={bond.cursor_timestamp ? frameMoment(bond.cursor_timestamp) : "the baseline only"}
        />
        <Small label="Term ends" value={displayDay(bond.expires_at)} />
      </dl>
    </li>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="hf-label">{label}</dt>
      <dd className="hf-record-sm mt-1">{value}</dd>
    </div>
  );
}
