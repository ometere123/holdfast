"use client";

/**
 * Bonding a page: nine fields, and every rule the contract will apply, applied here first.
 *
 * `validate.ts` mirrors the contract's deterministic refusals field by field, and this file adds the
 * other half: a zero-value simulation of the identical call, which reaches the refusals `validate.ts`
 * cannot know about because they are about contract state rather than about the draft.
 *
 * Both used to be the thing standing between a typo and a lost stake, because `create_bond` refused
 * by reverting and a revert on a payable method keeps the value. That was measured on chain and the
 * contract changed: it refunds and returns the tagged sentence now. So a rule missing here costs a
 * signature, a wait, and a refund that arrives at finality rather than immediately, which is worth
 * preventing and is not the same emergency it was.
 *
 * Three things are deliberately not hidden from the person filling this in.
 *
 * The anchor is derived from the URL and shown read only, because a chosen anchor would let somebody
 * bond a page against a marker that cannot fail. The commitment is shown twice, as typed and as the
 * contract will normalize and hash it, because the hash is what gets stored and a reader who has not
 * seen the normalized form does not know what they signed. And the four things no form can check are
 * printed beside the send button rather than after it, so a clean form never reads as a bond.
 */

import { useState } from "react";
import Link from "next/link";
import type { Limits } from "@/lib/contract-types";
import { resolveLimits } from "@/lib/contract-types";
import { classifyDryRun, dryRunCreateBond, type DryRun } from "@/lib/dry-run";
import { formatGen, genToWei, normalizeCommitment } from "@/lib/format";
import { OUTCOMES } from "@/lib/lifecycle";
import {
  anchorEntries,
  anchorWordsJson,
  derivedAnchorOf,
  emptyDraft,
  UNCHECKABLE_BEFORE_SIGNING,
  validateDraft,
  type BondDraft,
} from "@/lib/validate";
import { explorerTxUrl } from "@/lib/genlayer/config";
import { PhaseStrip } from "./phase-strip";
import { ProgramTable } from "./program-table";
import { useWallet } from "./wallet-provider";
import { useWriteRunner } from "./write-runner";

/** The eight arguments `create_bond` takes, in the contract's order and not the form's. */
function createArgs(draft: BondDraft): string[] {
  return [
    draft.bondId.trim(),
    draft.url.trim(),
    draft.commitment,
    draft.baselineTimestamp.trim(),
    anchorWordsJson(draft.anchorEntries),
    draft.anchorTerminal.trim(),
    draft.payee.trim(),
    draft.termDays.trim(),
  ];
}

export function CreateForm({ limits }: { limits?: Limits }) {
  const wallet = useWallet();
  const { state, run, reset, walletGate } = useWriteRunner();
  const resolved = resolveLimits(limits);
  const [draft, setDraft] = useState<BondDraft>(() => emptyDraft(resolved));
  const [dry, setDry] = useState<DryRun | null>(null);
  const [simulating, setSimulating] = useState(false);

  const errors = validateDraft(draft, wallet.address, resolved);
  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;
  const busy = state.phase !== "idle" && state.phase !== "settled";

  const set = (field: keyof BondDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Any edit invalidates the simulation. A stale green result beside a changed URL is the exact
    // shape of a mistake this whole file exists to prevent.
    setDry(null);
  };

  const anchor = derivedAnchorOf(draft.url);
  const sections = anchorEntries(draft.anchorEntries);
  const normalized = normalizeCommitment(draft.commitment);
  const stakeWei = (() => {
    try {
      return genToWei(draft.stake);
    } catch {
      return undefined;
    }
  })();

  async function simulate() {
    setSimulating(true);
    setDry(null);
    try {
      // The wallet's own client is used when a session is open, so the simulated sender is the
      // address that would really sign. That is the only way the contract's own "payee must not be
      // the promisor" rule gets exercised rather than merely mirrored here.
      const client = wallet.canWrite ? await wallet.getWriteClient() : undefined;
      setDry(await dryRunCreateBond(createArgs(draft), client));
    } catch (error) {
      setDry(classifyDryRun({ thrown: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSimulating(false);
    }
  }

  async function send() {
    if (stakeWei === undefined) return;
    await run({
      label: `Bond ${draft.bondId.trim()}`,
      functionName: "create_bond",
      args: createArgs(draft),
      value: stakeWei,
      bondId: draft.bondId.trim(),
      preflight: () => {
        const found = validateDraft(draft, wallet.address, resolved);
        if (found.length === 0) return null;
        return `This draft has ${found.length === 1 ? "one problem" : `${found.length} problems`} the contract would refuse, and refusing here costs nothing while refusing there costs a signature and a refund that arrives at finality: ${found[0].message}`;
      },
    });
  }

  return (
    <div>
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset className="border-0 p-0" disabled={busy}>
          <legend className="hf-label hf-label-ink">The page and the sentence</legend>

          <Field
            label="Page URL"
            hint="The published page the commitment lives on. https only, ASCII only, and its last path segment becomes gate B's anchor."
            error={errorFor("url")}
          >
            <input
              className="hf-input w-full"
              value={draft.url}
              onChange={(event) => set("url")(event.target.value)}
              placeholder="https://example.com/legal/retention-policy"
              spellCheck={false}
              inputMode="url"
            />
          </Field>

          <div className="mt-2 border-l-2 pl-4" style={{ borderColor: "var(--rule)" }}>
            <p className="hf-label">Anchor, derived not chosen</p>
            <p className="hf-record mt-1 break-words">{anchor || "nothing yet"}</p>
            <p className="hf-note mt-1 max-w-[74ch]">
              Taken from the last path segment of the URL by the same rule the contract uses. It is
              read only on purpose: a promisor who could pick the anchor could pick one that no
              capture will ever fail, which would make gate B decorative.
            </p>
          </div>

          <Field
            label="The commitment"
            hint={`The sentence being staked on, as published. At least ${resolved.commitmentMin} characters after normalization and at most ${resolved.commitmentMax} as typed.`}
            error={errorFor("commitment")}
          >
            <textarea
              className="hf-textarea w-full"
              rows={4}
              value={draft.commitment}
              onChange={(event) => set("commitment")(event.target.value)}
              placeholder="We retain customer content for no more than 30 days after account deletion."
            />
          </Field>

          {normalized ? (
            <div className="mt-2 border-l-2 pl-4" style={{ borderColor: "var(--diazo)" }}>
              <p className="hf-label">What the contract will hash</p>
              <p className="hf-record mt-1 max-w-[74ch] break-words">{normalized}</p>
              <p className="hf-note mt-1 max-w-[74ch]">
                Lower cased, punctuation dropped, whitespace runs collapsed to one space, and{" "}
                {normalized.length} characters long. The hash of this string is what the bond stores,
                so this is the form of the sentence that matters and not the one above it.
              </p>
            </div>
          ) : null}
        </fieldset>

        <div className="hf-rail mt-8" aria-hidden="true" />

        <fieldset className="mt-8 border-0 p-0" disabled={busy}>
          <legend className="hf-label hf-label-ink">The gates a capture must pass</legend>
          <details className="mt-2 max-w-[76ch]">
            <summary className="hf-label cursor-pointer">Technical detail</summary>
            <p className="hf-note mt-3">
              These gates describe a faithful capture. A broken page or navigation-only capture is
              refused as evidence rather than read as a vanished commitment.
            </p>
          </details>

          <Field
            label="Required sections, one per line"
            hint={`Gate C. Between ${resolved.anchorWordsMin} and ${resolved.anchorWordsMax} phrases, each of which must appear in a capture before it counts as the same document.`}
            error={errorFor("anchorEntries")}
          >
            <textarea
              className="hf-textarea w-full"
              rows={4}
              value={draft.anchorEntries}
              onChange={(event) => set("anchorEntries")(event.target.value)}
              placeholder={"customer content\ndata retention\nprivacy"}
              spellCheck={false}
            />
            <span className="hf-record-sm mt-1 block">
              {sections.length === 0
                ? "none yet"
                : `${sections.length} section${sections.length === 1 ? "" : "s"}: ${sections.join(" · ")}`}
            </span>
          </Field>

          <Field
            label="Terminal marker"
            hint="Gate D. A phrase from the end of the document, which proves the capture did not stop early. It has to be independent of the anchor and of every section above, or it cannot fail on its own."
            error={errorFor("anchorTerminal")}
          >
            <input
              className="hf-input w-full"
              value={draft.anchorTerminal}
              onChange={(event) => set("anchorTerminal")(event.target.value)}
              placeholder="contact our privacy team"
              spellCheck={false}
            />
          </Field>

          <p className="hf-note mt-4 max-w-[76ch]">
            There is a fourth gate and it ships disabled. A size ratio gate would have rejected a
            real capture whose text grew thirteenfold because navigation chrome was captured with it,
            in a period when the policy itself did not change.{" "}
            <Link className="underline" href="/method">
              The method page has the measurement.
            </Link>
          </p>
        </fieldset>

        <div className="hf-rail mt-8" aria-hidden="true" />

        <fieldset className="mt-8 border-0 p-0" disabled={busy}>
          <legend className="hf-label hf-label-ink">The baseline, the money and the term</legend>

          <Field
            label="Baseline capture timestamp"
            hint="14 digits, as in 20260822123203. This exact capture is fetched, verified and read before any stake is accepted, and every later capture is compared against it."
            error={errorFor("baselineTimestamp")}
          >
            <input
              className="hf-input w-full"
              value={draft.baselineTimestamp}
              onChange={(event) => set("baselineTimestamp")(event.target.value)}
              placeholder="20260822123203"
              inputMode="numeric"
              spellCheck={false}
            />
            {draft.url.trim() && draft.baselineTimestamp.trim().length === 14 ? (
              <a
                className="hf-diazo hf-record-sm mt-1 block underline"
                href={`https://web.archive.org/web/${draft.baselineTimestamp.trim()}/${draft.url.trim()}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open this capture in the archive before staking on it
              </a>
            ) : null}
          </Field>

          <Field
            label="Bond id"
            hint="Your own label for this bond, up to 64 characters. It has to be unique on the contract, which is one of the things the simulation below can tell you and this form cannot."
            error={errorFor("bondId")}
          >
            <input
              className="hf-input w-full"
              value={draft.bondId}
              onChange={(event) => set("bondId")(event.target.value)}
              placeholder="retention-policy-2026"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Payee"
            hint="Who receives the stake if a breach is settled. Not you: a bond payable to its own poster is not a promise to anyone."
            error={errorFor("payee")}
          >
            <input
              className="hf-input w-full"
              value={draft.payee}
              onChange={(event) => set("payee")(event.target.value)}
              placeholder="0x0000000000000000000000000000000000000000"
              spellCheck={false}
            />
          </Field>

          <div className="mt-5 grid gap-x-8 gap-y-5 strip:grid-cols-2">
            <Field label="Stake in GEN" hint="Held by the contract for the whole term." error={errorFor("stake")}>
              <input
                className="hf-input w-full"
                value={draft.stake}
                onChange={(event) => set("stake")(event.target.value)}
                placeholder="100"
                inputMode="decimal"
                spellCheck={false}
              />
              {stakeWei !== undefined && stakeWei > 0n ? (
                <span className="hf-record-sm mt-1 block">
                  {formatGen(stakeWei)}, sent with this call as value
                </span>
              ) : null}
            </Field>

            <Field
              label="Term in days"
              hint={`Between ${resolved.termDaysMin} and ${resolved.termDaysMax}. There is no renewal: renewing would re-anchor the term against a new baseline, and that path is untested, so it is absent.`}
              error={errorFor("termDays")}
            >
              <input
                className="hf-input w-full"
                value={draft.termDays}
                onChange={(event) => set("termDays")(event.target.value)}
                inputMode="numeric"
                spellCheck={false}
              />
            </Field>
          </div>
        </fieldset>

        <div className="hf-rail mt-8" aria-hidden="true" />

        <section className="mt-8" aria-labelledby="dry-heading">
          <h2 className="hf-heading" id="dry-heading">
            Ask the contract before you pay it
          </h2>
          <details className="mt-3 max-w-[80ch]">
            <summary className="hf-label cursor-pointer">What the dry run checks</summary>
            <p className="hf-note mt-3">
              This sends the identical call with no value. The contract checks value last, so the
              simulation exercises deterministic refusals before stopping at the missing stake.
              Archive-dependent checks still require the funded call.
            </p>
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="hf-btn"
              disabled={simulating || errors.length > 0}
              onClick={() => void simulate()}
            >
              {simulating ? "Simulating" : "Simulate this call"}
            </button>
            <span className="hf-record-sm">
              {errors.length > 0
                ? "Fix the fields above first. There is no point asking the contract about a draft this browser already refuses."
                : "No signature, no value, no state change."}
            </span>
          </div>

          {dry ? <DryRunPanel result={dry} sender={wallet.canWrite ? wallet.address : undefined} /> : null}
        </section>

        <div className="hf-rail mt-8" aria-hidden="true" />

        <section className="mt-8" aria-labelledby="send-heading">
          <h2 className="hf-heading" id="send-heading">
            What signing this cannot tell you
          </h2>
          <p className="hf-body mt-3 max-w-[80ch]">
            A clean form is not a bond. Four refusals are out of this browser&apos;s reach, and the
            first three of them are out of the simulation&apos;s reach too, because they need the
            archive:
          </p>
          <ul className="hf-note mt-3 max-w-[76ch] list-disc pl-6">
            {UNCHECKABLE_BEFORE_SIGNING.map((item, index) => (
              <li key={item} className="mt-1">
                {item}
                {index === UNCHECKABLE_BEFORE_SIGNING.length - 1 ? (
                  <span>
                    {" "}
                    This last one is the exception: it is checked before the contract touches the
                    network, so the simulation above does answer it.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="hf-note mt-3 max-w-[76ch]">
            If one of the first three refuses the call, the transaction reverts and the stake does
            not arrive. That is the failure mode this contract chose over accepting the value and
            returning it, and the reasoning is in the method table below.
          </p>

          <ProgramTable functionName="create_bond" />

          {walletGate ? (
            <p className="hf-note mt-6 max-w-[76ch]">{walletGate}</p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              className="hf-btn-diazo"
              disabled={busy || errors.length > 0 || stakeWei === undefined}
            >
              {busy ? "Sending" : "Stake and bond this page"}
            </button>
            <span className="hf-record-sm">
              {stakeWei === undefined || stakeWei <= 0n
                ? "gas, plus the stake once it is a number"
                : `gas, plus ${formatGen(stakeWei)} held in escrow`}
            </span>
          </div>

          {errors.length > 0 ? (
            <div className="mt-5 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
              <p className="hf-label hf-label-ink">
                {errors.length === 1 ? "One field" : `${errors.length} fields`} the contract would
                refuse
              </p>
              <ul className="mt-2 list-none p-0">
                {errors.map((error) => (
                  <li key={error.field} className="hf-note mt-2 max-w-[74ch]">
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <PhaseStrip phase={state.phase} />

          {state.hash ? (
            <p className="hf-record mt-4 break-words">
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
              {state.hash ? (
                <p className="hf-note mt-3 max-w-[74ch]">
                  This call reverted after it was submitted, which means the stake did not leave your
                  wallet and did not arrive in the contract. Nothing was bonded and nothing was held.
                </p>
              ) : null}
              <button type="button" className="hf-btn-quiet mt-4" onClick={reset}>
                Clear this and try again
              </button>
            </div>
          ) : null}

          {state.phase === "settled" ? (
            <div className="mt-5 border p-4" style={{ borderColor: "var(--emulsion)" }}>
              <p className="hf-body max-w-[74ch]">
                Bonded. The stake is in escrow and the baseline capture qualified, which is the only
                reason this call succeeded at all.
              </p>
              <Link
                className="hf-btn-diazo mt-4 inline-block no-underline"
                href={`/bonds/${draft.bondId.trim()}`}
              >
                Open the bond
              </Link>
            </div>
          ) : null}
        </section>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-5 block">
      <span className="hf-label hf-label-ink block">{label}</span>
      <span className="hf-note mt-1 block max-w-[76ch]">{hint}</span>
      <span className="mt-2 block">{children}</span>
      {error ? (
        <span className="hf-note mt-1 block max-w-[74ch]" style={{ color: "var(--diazo)" }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * The five dry run outcomes, drawn as five different things.
 *
 * The important one to get right is not the pass, it is the pair below it. A node that would not
 * simulate the call and a simulation that came back untagged are both "we do not know", and drawing
 * either of them as a pass would hand somebody a false clearance on a call they are about to fund.
 */
function DryRunPanel({ result, sender }: { result: DryRun; sender?: string }) {
  const border = result.kind === "PASSED" ? "var(--emulsion)" : "var(--rule-strong)";
  const heading: Record<DryRun["kind"], string> = {
    PASSED: "The contract accepted everything it can check without the network",
    REFUSED: "The contract refused this draft",
    UNSUPPORTED: "The simulation was not available",
    INCONCLUSIVE: "The simulation answered nothing",
    SKIPPED: "There was nothing to simulate against",
  };

  return (
    <div className="mt-5 border p-4" style={{ borderColor: border }}>
      <p className="hf-body">
        <span className="hf-record hf-tag">{result.kind.toLowerCase()}</span> {heading[result.kind]}
      </p>
      <p className="hf-note mt-2 max-w-[76ch]">
        {result.kind === "PASSED"
          ? result.caveat
          : result.kind === "REFUSED"
            ? result.reason
            : result.detail}
      </p>
      <p className="hf-record-sm mt-3 max-w-[76ch]">
        {sender
          ? `Simulated as ${sender}, the address that would sign, so the contract's own rule that the payee is not the promisor ran for real.`
          : "Simulated from a throwaway read address, because no wallet session is open. The contract's rule that the payee is not the promisor was therefore checked against nothing, and only the local check above covers it."}
      </p>
    </div>
  );
}
