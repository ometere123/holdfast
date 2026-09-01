"use client";

/**
 * The five calls that can be made on a bond, with the reason attached when one cannot.
 *
 * Four of the five are callable by a stranger. That is the product rather than a permission
 * setting: nobody has to be trusted to run the check, and the one call reserved to the promisor is
 * their defence rather than their obligation. So the caller column is printed, not implied.
 *
 * No button is ever dead without a sentence. `bondActions` produces availability and the reason for
 * unavailability together, from the bond's own stored fields, and the same value feeds the disabled
 * attribute and the preflight that refuses the write for free. A reader who cannot act should learn
 * why from the screen and not from a revert.
 *
 * `create_bond` is deliberately absent from this file. It takes nine fields and a stake, so its
 * validation lives beside its form where every rule can run before a wallet opens rather than
 * costing a signature and a refund.
 *
 * `contest_breach` is here and is the other payable call, which is why its preflight matters for the
 * same reason and to the same degree.
 */

import { useEffect, useState } from "react";
import type { ActionKey, BondAction } from "@/lib/actions";
import { bondActions, nextAction } from "@/lib/actions";
import type { Bond, Limits } from "@/lib/contract-types";
import { resolveLimits, sameAddress } from "@/lib/contract-types";
import { formatGen, percentOfWei } from "@/lib/format";
import { OUTCOMES } from "@/lib/lifecycle";
import { validateContest } from "@/lib/validate";
import { explorerTxUrl } from "@/lib/genlayer/config";
import { PhaseStrip } from "./phase-strip";
import { ProgramTable } from "./program-table";
import { useWallet } from "./wallet-provider";
import { useWriteRunner } from "./write-runner";

export function BondActions({
  bond,
  limits,
  nowIso,
}: {
  bond: Bond;
  limits?: Limits;
  /** The server's clock at render time. Refreshed here so an open page does not go stale. */
  nowIso: string;
}) {
  const wallet = useWallet();
  const { state, run, reset, walletGate } = useWriteRunner();
  const [now, setNow] = useState(nowIso);
  const [chosen, setChosen] = useState<ActionKey | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceTimestamp, setEvidenceTimestamp] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const resolved = resolveLimits(limits);
  const actions = bondActions(bond, now, resolved);
  const lead = nextAction(bond, now, resolved);
  const selected = chosen ? actions.find((action) => action.key === chosen) : undefined;
  const contestBondWei = percentOfWei(bond.stake, resolved.contestBondPct);
  const isPromisor = sameAddress(bond.promisor, wallet.address);
  const busy = state.phase !== "idle" && state.phase !== "settled";

  const contestErrors = validateContest(evidenceUrl, evidenceTimestamp);

  async function send(action: BondAction) {
    if (action.key === "contest_breach") {
      await run({
        label: `${action.verb} on ${bond.bond_id}`,
        functionName: "contest_breach",
        args: [bond.bond_id, evidenceUrl.trim(), evidenceTimestamp.trim()],
        value: BigInt(contestBondWei || "0"),
        bondId: bond.bond_id,
        preflight: () => {
          if (!action.available) return action.reason;
          if (!isPromisor) {
            return "The contract checks the caller on this one call, and this wallet is not the bond's promisor. Nothing was sent.";
          }
          const errors = validateContest(evidenceUrl, evidenceTimestamp);
          return errors.length > 0 ? errors[0].message : null;
        },
      });
      return;
    }

    await run({
      label: `${action.verb} on ${bond.bond_id}`,
      functionName: action.method,
      args: [bond.bond_id],
      bondId: bond.bond_id,
      preflight: () => (action.available ? null : action.reason),
    });
  }

  return (
    <section aria-labelledby="actions-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="hf-heading" id="actions-heading">
          What can be done now
        </h2>
        <p className="hf-record-sm">
          bounds from {resolved.source === "contract" ? "get_limits()" : "the client mirror"}
        </p>
      </div>

      <p className="hf-body mt-3 max-w-[76ch]">
        {lead?.available
          ? `The next valid call on this bond is to ${lead.verb.toLowerCase()}.`
          : "No call is valid on this bond at this moment. Each row below says why."}{" "}
        Four of the five are callable by anyone, so no state on this page depends on a particular
        person being available.
      </p>

      {walletGate ? <p className="hf-note mt-3 max-w-[76ch]">{walletGate}</p> : null}

      <ul className="mt-5 list-none p-0">
        {actions.map((action) => {
          const isLead = action.key === lead?.key && action.available;
          const isOpen = action.key === chosen;
          return (
            <li key={action.key} className="border-t py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="max-w-[62ch]">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="hf-body">{action.verb}</span>
                    <span className="hf-record-sm">{action.method}</span>
                    <span className="hf-record hf-tag">
                      {action.permissionless ? "anyone" : action.caller}
                    </span>
                  </div>
                  <p className="hf-note mt-1">{action.effect}</p>
                  <p className="hf-record-sm mt-1">{action.cost}</p>
                  {action.available ? null : <p className="hf-note mt-2">{action.reason}</p>}
                  {action.key === "contest_breach" && action.available && !isPromisor ? (
                    <p className="hf-note mt-2">
                      This is the one call on this contract a stranger cannot make. The connected
                      wallet is not this bond&apos;s promisor, so the contract would refuse it.
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  className={isLead ? "hf-btn-diazo" : "hf-btn"}
                  disabled={!action.available || busy}
                  aria-expanded={isOpen}
                  onClick={() => {
                    reset();
                    setChosen(isOpen ? null : action.key);
                  }}
                >
                  {isOpen ? "Close" : action.verb}
                </button>
              </div>

              {isOpen ? (
                <div className="mt-5 border-t pt-5">
                  {action.key === "contest_breach" ? (
                    <div className="mb-6">
                      <h3 className="hf-heading">The capture you are citing</h3>
                      <p className="hf-note mt-2 max-w-[74ch]">
                        A URL and a 14 digit archive timestamp, held to the same standards as the
                        bonded URL. Nothing is fetched to check them here: filing is entirely
                        deterministic, and the citation is judged when anyone calls the adjudication.
                      </p>

                      <div className="mt-4 grid gap-4 strip:grid-cols-2">
                        <label className="block">
                          <span className="hf-label hf-label-ink block">Cited URL</span>
                          <input
                            className="hf-input mt-1 w-full"
                            value={evidenceUrl}
                            onChange={(event) => setEvidenceUrl(event.target.value)}
                            placeholder="https://example.com/terms"
                            spellCheck={false}
                          />
                        </label>
                        <label className="block">
                          <span className="hf-label hf-label-ink block">Cited timestamp</span>
                          <input
                            className="hf-input mt-1 w-full"
                            value={evidenceTimestamp}
                            onChange={(event) => setEvidenceTimestamp(event.target.value)}
                            placeholder="20260214093000"
                            inputMode="numeric"
                            spellCheck={false}
                          />
                        </label>
                      </div>

                      {contestErrors.length > 0 ? (
                        <ul className="mt-3 list-none p-0">
                          {contestErrors.map((error) => (
                            <li key={error.field} className="hf-note mt-1">
                              {error.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <p className="hf-record-sm mt-4">
                        Contest bond: {formatGen(contestBondWei)}, which is{" "}
                        {resolved.contestBondPct}% of the stake. Returned if the cited capture reads
                        as holding. Forfeited with the stake if it does not.
                      </p>
                    </div>
                  ) : null}

                  <ProgramTable functionName={action.method} />

                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      className="hf-btn-diazo"
                      disabled={
                        busy ||
                        (action.key === "contest_breach" && contestErrors.length > 0)
                      }
                      onClick={() => void send(action)}
                    >
                      {busy ? "Sending" : action.verb}
                    </button>
                    <span className="hf-record-sm">{action.cost}</span>
                  </div>

                  <PhaseStrip phase={state.phase} />

                  {state.hash ? (
                    <p className="hf-record mt-4">
                      <a
                        className="underline"
                        href={explorerTxUrl(state.hash)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {state.hash}
                      </a>
                    </p>
                  ) : null}

                  {state.outcome && state.outcome !== "finding" ? (
                    <div className="mt-5 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
                      <p className="hf-body">
                        <span className="hf-record hf-tag hf-tag-verdict">
                          {OUTCOMES[state.outcome].tag}
                        </span>{" "}
                        {OUTCOMES[state.outcome].headline}
                      </p>
                      <p className="hf-note mt-2 max-w-[74ch]">{OUTCOMES[state.outcome].body}</p>
                      {state.message ? (
                        <p className="hf-record mt-3 max-w-[74ch] break-words">{state.message}</p>
                      ) : null}
                      <dl className="mt-3">
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="hf-label">The reel</dt>
                          <dd className="hf-note">{OUTCOMES[state.outcome].strip}</dd>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2">
                          <dt className="hf-label">The light table</dt>
                          <dd className="hf-note">{OUTCOMES[state.outcome].lightTable}</dd>
                        </div>
                      </dl>
                      {OUTCOMES[state.outcome].retry ? (
                        <p className="hf-note mt-3">
                          Nothing was decided, so sending the same call again is the expected next
                          step.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {state.phase === "settled" ? (
                    <p className="hf-body mt-5 max-w-[74ch]">
                      Finalized. Reload this page to read what the call recorded: every figure here
                      comes from the contract, so nothing is shown until the contract says it.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {selected ? null : (
        <p className="hf-note mt-4 max-w-[76ch]">
          Choosing a call above prints its program of work before anything is signed: every step,
          its source, and whether it is arithmetic, a fetch, or a reading of text.
        </p>
      )}
    </section>
  );
}
