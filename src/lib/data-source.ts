/**
 * The one gate between the bundled fixtures and the deployed contract.
 *
 * Every page and component in this app reads through this module and nothing else. No
 * component imports `mock-data.ts` and no component imports `live-contract.ts`. Set
 * NEXT_PUBLIC_HOLDFAST_CONTRACT and every function below stops returning fixtures and starts
 * returning contract state, and not one component changes.
 *
 * Two things are refused here on principle.
 *
 * A read that fails is never converted into an empty result. `ReadResult` carries
 * UNAVAILABLE and INVALID_RESPONSE separately from NOT_FOUND, and the pages render all three
 * differently, because a bond list that could not be fetched and a bond list with nothing in
 * it are different facts and only one of them is reassuring.
 *
 * And nothing here invents a number. There is no fixture branch that supplies a minimum
 * stake, a check interval or a gate threshold that the contract did not state. The limits come
 * from `get_limits()` in live mode and from the contract's own constants in fixture mode, and
 * `limitsDrift` compares the two so a client mirror that falls behind the contract is a visible
 * disagreement rather than a form that accepts a bond the chain will refuse.
 */

import type {
  Bond,
  BondHistory,
  BondSummary,
  CommitmentStatus,
  Ledger,
  Limits,
} from "./contract-types.ts";
import { CONTRACT_ADDRESS, DATA_MODE, IS_LIVE } from "./genlayer/config.ts";
import { available, notFound, type ReadResult } from "./genlayer/read-result.ts";
import * as live from "./live-contract.ts";
import {
  MOCK_LEDGER,
  MOCK_LIMITS,
  mockBond,
  mockHistory,
  mockStatus,
  mockSummaries,
} from "./mock-data.ts";

export type DataMode = "live" | "fixtures";

export const dataMode: DataMode = IS_LIVE ? "live" : "fixtures";

/** What the banner at the top of every page says, and why. */
export function dataProvenance(): { mode: DataMode; line: string } {
  if (IS_LIVE) {
    return {
      mode: "live",
      line: `Reading the Holdfast contract at ${CONTRACT_ADDRESS}. Every digest, timestamp and gate result on this page is contract state.`,
    };
  }
  if (DATA_MODE === "live") {
    return {
      mode: "fixtures",
      line: "Live mode is requested but no contract address is configured, so these are bundled fixtures. Nothing here is chain state.",
    };
  }
  return {
    mode: "fixtures",
    line: "These are bundled fixtures, not chain state. The byte counts, encodings and size caps are the measured ones. The bonds, digests, addresses and example domains are not real.",
  };
}

/**
 * `list_bonds`, which returns eight fields per bond and not a whole bond.
 *
 * The index page is built on this narrower shape deliberately. A list view that received 39
 * fields per row would end up printing one of the ones it should not: a breach excerpt has no
 * meaning without the capture it was quoted from beside it.
 */
export async function listBonds(): Promise<ReadResult<BondSummary[]>> {
  if (IS_LIVE) return live.listBonds();
  return available(mockSummaries());
}

export async function getBond(id: string): Promise<ReadResult<Bond>> {
  if (IS_LIVE) return live.getBond(id);
  const found = mockBond(id);
  return found ? available(found) : notFound();
}

export async function getBondHistory(id: string): Promise<ReadResult<BondHistory>> {
  if (IS_LIVE) return live.getBondHistory(id);
  const found = mockHistory(id);
  return found ? available(found) : notFound();
}

/**
 * The integration surface, read the way a procurement bot would read it: keyed by bond id.
 *
 * Not by url. The same page can carry several bonds, from different promisors quoting different
 * sentences out of it, and a url-keyed lookup would have to choose one of them and present it as
 * the answer. An unknown id is NOT_FOUND and never an empty tally, because a tally of zeroes
 * reads on screen as a page nobody has found anything wrong with.
 */
export async function commitmentStatus(bondId: string): Promise<ReadResult<CommitmentStatus>> {
  if (IS_LIVE) return live.commitmentStatus(bondId);
  const found = mockStatus(bondId);
  return found ? available(found) : notFound();
}

/** `get_ledger`. Cumulative totals, so what is still held is escrowed minus the two payouts. */
export async function getLedger(): Promise<ReadResult<Ledger>> {
  if (IS_LIVE) return live.getLedger();
  return available(MOCK_LEDGER);
}

/**
 * `get_limits`. Every bound the forms validate against comes from here and none is hardcoded.
 *
 * This is why the create form can be trusted: it refuses what the contract would refuse, using
 * the contract's own numbers, so a constant that changes in `Holdfast.py` changes the form
 * without anyone remembering to.
 */
export async function getLimits(): Promise<ReadResult<Limits>> {
  if (IS_LIVE) return live.getLimits();
  return available(MOCK_LIMITS);
}

/* ------------------------------------------------------------------------- *
 * Derived, so the same arithmetic is not repeated on three pages
 * ------------------------------------------------------------------------- */

export type LedgerCounts = {
  total: number;
  active: number;
  claimed: number;
  contested: number;
  breached: number;
  returned: number;
  stakeEscrowedWei: bigint;
};

/**
 * Counted from the summaries the list view already has, rather than from a second read.
 *
 * `stakeEscrowedWei` counts the three live states only. A settled bond's stake has left the
 * contract, and including it would inflate the figure on the index page above what
 * `get_ledger` reports as still held.
 */
export function countBonds(bonds: Pick<BondSummary, "state" | "stake">[]): LedgerCounts {
  const by = (state: BondSummary["state"]) => bonds.filter((bond) => bond.state === state).length;
  const escrowed = bonds
    .filter(
      (bond) =>
        bond.state === "ACTIVE" || bond.state === "BREACH_CLAIMED" || bond.state === "CONTESTED",
    )
    .reduce((total, bond) => {
      try {
        return total + BigInt(bond.stake);
      } catch {
        return total;
      }
    }, 0n);
  return {
    total: bonds.length,
    active: by("ACTIVE"),
    claimed: by("BREACH_CLAIMED"),
    contested: by("CONTESTED"),
    breached: by("BREACHED"),
    returned: by("RETURNED"),
    stakeEscrowedWei: escrowed,
  };
}

/** The sentence a failed read prints. Never "none found", because that is a different fact. */
export function readFailureLine(result: ReadResult<unknown>, subject: string): string {
  if (result.kind === "AVAILABLE") return "";
  if (result.kind === "NOT_FOUND") return `The contract holds no ${subject}.`;
  return `The ${subject} could not be read: ${result.kind === "UNAVAILABLE" ? "the node did not answer" : "the response was the wrong shape"}. ${result.error} Nothing is implied about the commitment either way.`;
}
