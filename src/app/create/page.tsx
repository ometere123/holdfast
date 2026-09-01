/**
 * Bonding a page.
 *
 * The server reads `get_limits()` once and hands it down, so the form's bounds are the contract's
 * own numbers rather than the client mirror whenever the contract is reachable. When it is not, the
 * form still works off the mirror and this page says which one is in force, because a form that
 * silently enforces stale bounds would refuse drafts the contract would accept.
 */

import Link from "next/link";
import { CreateForm } from "@/components/create-form";
import { limitsDrift } from "@/lib/contract-types";
import { getLimits, readFailureLine } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const limitsRead = await getLimits();
  const limits = limitsRead.kind === "AVAILABLE" ? limitsRead.value : undefined;
  const drift = limits ? limitsDrift(limits) : [];

  return (
    <div>
      <p className="hf-label">New bond</p>
      <h1 className="hf-display mt-1">Stake on a sentence you published</h1>

      <p className="hf-body mt-4 max-w-[80ch]">
        You name a page, quote the commitment on it, and deposit value against it for a term. From
        then on anyone at all can ask the contract to read that page as the Internet Archive recorded
        it and record what the archived text says. If two consecutive faithful captures read as
        weaker or silent on the commitment, the stake is claimable by the payee you name here.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        The live page is never the evidence. Nothing you do to the page after bonding it changes what
        the archive already recorded, and nothing the archive fails to record counts against you.
      </p>

      {limitsRead.kind === "AVAILABLE" ? (
        <p className="hf-record-sm mt-4">
          Bounds below are the contract&apos;s own, read from get_limits at page load.
        </p>
      ) : (
        <p className="hf-note mt-4 max-w-[80ch]">
          {readFailureLine(limitsRead, "contract limits")} The bounds below are this build&apos;s
          mirror of them instead. They agreed at build time, but the contract is the authority and it
          could not be asked just now.
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
          <p className="hf-note mt-2 max-w-[74ch]">
            The form enforces the contract&apos;s numbers, which is the safe direction. This notice
            exists because a mirror that has drifted is a bug in this build and should not be silent.
          </p>
        </div>
      ) : null}

      <CreateForm limits={limits} />

      <div className="hf-rail mt-10" aria-hidden="true" />

      <p className="hf-note mt-6 max-w-[80ch]">
        Every step this call takes, in order, with its source and whether it is arithmetic, a fetch or
        a reading, is on{" "}
        <Link className="underline" href="/method">
          the method page
        </Link>
        , along with why the archive is the only witness this contract will accept.
      </p>
    </div>
  );
}
