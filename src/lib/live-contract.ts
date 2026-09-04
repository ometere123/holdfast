/**
 * Live view calls, one per view the contract actually exposes.
 *
 * This sits beside `src/lib/genlayer/` rather than inside it, because that directory is a
 * proven client layer copied from a shipped project and is not edited here. Everything below
 * is built out of it: `createReadClient` for the transport, `performRead` for the three way
 * result, and nothing else.
 *
 * The validators are deliberately shallow. They check that the response is the right kind of
 * thing and that the fields the interface indexes into exist, and they do not coerce. A
 * response that is the wrong shape becomes INVALID_RESPONSE, which the interface renders as a
 * read that could not be completed. It never becomes an empty bond, because an empty bond
 * would read on screen as a bond with nothing wrong with it.
 *
 * Every key checked below was read off `contracts/Holdfast.py`. An earlier version of this file
 * checked for `id`, `commitment_raw`, `cdx_digest`, `gate`, `digest_verified`, `standing` and a
 * `stats` method, none of which the contract has, so every read in the app would have come back
 * INVALID_RESPONSE. It would have failed safe and failed completely. `npm run verify:schema`
 * now compares `REQUIRED_METHODS` against the deployed method table, so a name that does not
 * exist is a build failure rather than a runtime surprise.
 */

import type {
  Bond,
  BondHistory,
  BondSummary,
  ChangePoint,
  CommitmentStatus,
  Ledger,
  Limits,
} from "./contract-types.ts";
import { CONTRACT_ADDRESS } from "./genlayer/config.ts";
import { createReadClient } from "./genlayer/read-client.ts";
import { normalizeError } from "./wallet-errors.ts";
import {
  available,
  invalidResponse,
  isRecord,
  notFound,
  performRead,
  unavailable,
  type ReadResult,
} from "./genlayer/read-result.ts";

function callView(functionName: string, args: unknown[] = []) {
  if (!CONTRACT_ADDRESS) throw new Error("No deployed contract address is configured.");
  const client = createReadClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    // genlayer-js types view args as CalldataEncodable. Every argument this app sends is a
    // string, which is encodable, so the cast is narrowing rather than widening.
    args: args as never[],
  });
}

function hasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && keys.every((key) => key in value);
}

/**
 * The contract's own sentence for an id it does not hold: `Holdfast.py:2133` raises
 * `UserError("[EXPECTED] no bond 'x'")` from `_require_bond`, which is what every keyed view
 * goes through.
 *
 * Matched on, rather than guessed at, so that a bond that does not exist reads as
 * NOT_FOUND instead of as the node having failed to answer. Those are different facts and the
 * pages print them differently. `tests/direct/test_views.py` asserts this exact prefix against
 * the deployed contract, so if the wording ever changes the suite says so rather than this
 * quietly degrading to UNAVAILABLE.
 */
const NO_SUCH_BOND = "no bond";

function looksLikeMissingBond(error: unknown): boolean {
  const message = normalizeError(error);
  return message.includes(NO_SUCH_BOND);
}

/**
 * A read keyed by bond id, where "the contract does not hold this" is an answer and not a fault.
 *
 * `performRead` cannot do this, because it treats every thrown error as UNAVAILABLE, which is
 * right for an unkeyed read and wrong here.
 */
async function performKeyedRead<T>(
  read: () => Promise<unknown>,
  validate: (value: unknown) => value is T,
  invalidMessage: string,
): Promise<ReadResult<T>> {
  try {
    const value = await read();
    return validate(value) ? available(value) : invalidResponse(invalidMessage);
  } catch (error) {
    return looksLikeMissingBond(error) ? notFound() : unavailable(error);
  }
}

/* ------------------------------------------------------------------------- *
 * Validators, keyed on fields the contract returns
 * ------------------------------------------------------------------------- */

/** A representative spread of `get_bond`'s 39 keys: identity, money, state, baseline, custody. */
const BOND_KEYS = [
  "bond_id",
  "promisor",
  "payee",
  "url",
  "commitment",
  "commitment_sha256",
  "baseline_timestamp",
  "baseline_digest",
  "stake",
  "state",
  "expires_at",
  "cursor_timestamp",
  "checks_passed",
  "points_recorded",
  "run_length",
  "contest_deadline",
  "settled",
];

/** `list_bonds` returns eight fields and not a `Bond`, so it is validated as its own shape. */
const BOND_SUMMARY_KEYS = [
  "bond_id",
  "url",
  "state",
  "stake",
  "expires_at",
  "cursor_timestamp",
  "checks_passed",
  "points_recorded",
];

/**
 * `qualified` and `failed_gates` are checked by name because they are the two the frame strip
 * branches on, and a history missing either would draw every capture as blank.
 */
const CHANGE_POINT_KEYS = [
  "bond_id",
  "timestamp",
  "digest",
  "raw_len",
  "encoding",
  "qualified",
  "failed_gates",
  "classification",
  "observed_at",
];

const STATUS_KEYS = [
  "bond_id",
  "state",
  "url",
  "commitment",
  "examined",
  "qualified",
  "gate_rejected",
  "holds",
  "weakened",
  "absent",
  "indeterminate",
  "run_length",
  "breach_run_needed",
];

const LEDGER_KEYS = [
  "total_escrowed",
  "total_paid_to_payees",
  "total_returned_to_promisors",
  "bonds_created",
  "checks_run",
  "breaches_claimed",
  "contests_filed",
  "fee_basis_points",
];

const LIMITS_KEYS = [
  "min_term_days",
  "max_term_days",
  "min_commitment_chars",
  "max_commitment_chars",
  "min_anchor_words",
  "max_anchor_words",
  "min_change_points",
  "breach_run_length",
  "check_interval_seconds",
  "contest_window_seconds",
  "contest_bond_basis_points",
  "cdx_warc_length_max",
  "raw_max_bytes",
  "decoded_max_bytes",
  "max_points_per_check",
  "gate_a_enabled",
];

const isBond = (value: unknown): value is Bond => hasKeys(value, BOND_KEYS);

const isBondSummary = (value: unknown): value is BondSummary => hasKeys(value, BOND_SUMMARY_KEYS);

const isBondSummaryList = (value: unknown): value is BondSummary[] =>
  Array.isArray(value) && value.every(isBondSummary);

const isChangePoint = (value: unknown): value is ChangePoint => hasKeys(value, CHANGE_POINT_KEYS);

/**
 * A history is a flat list, and an empty list is a valid answer.
 *
 * A bond created and never checked has examined nothing, which is not the same as a read that
 * failed and is not the same as a bond that does not exist. All three reach the page separately.
 */
const isHistory = (value: unknown): value is BondHistory =>
  Array.isArray(value) && value.every(isChangePoint);

const isStatus = (value: unknown): value is CommitmentStatus => hasKeys(value, STATUS_KEYS);

const isLedger = (value: unknown): value is Ledger => hasKeys(value, LEDGER_KEYS);

const isLimits = (value: unknown): value is Limits => hasKeys(value, LIMITS_KEYS);

/* ------------------------------------------------------------------------- *
 * The six views
 * ------------------------------------------------------------------------- */

export function listBonds(): Promise<ReadResult<BondSummary[]>> {
  return performRead(
    () => callView("list_bonds"),
    isBondSummaryList,
    "list_bonds did not return a list of bond summaries.",
  );
}

export function getBond(bondId: string): Promise<ReadResult<Bond>> {
  return performKeyedRead(
    () => callView("get_bond", [bondId]),
    isBond,
    `get_bond returned something that is not a bond record for ${bondId}.`,
  );
}

export function getBondHistory(bondId: string): Promise<ReadResult<BondHistory>> {
  return performKeyedRead(
    () => callView("bond_history", [bondId]),
    isHistory,
    `bond_history returned something that is not a list of change points for ${bondId}.`,
  );
}

/**
 * Keyed by bond id, not by url.
 *
 * The url is not the key: the same page can carry more than one bond, from different promisors
 * with different commitments, and a url-keyed lookup would have to pick one and call it the
 * answer.
 */
export function commitmentStatus(bondId: string): Promise<ReadResult<CommitmentStatus>> {
  return performKeyedRead(
    () => callView("commitment_status", [bondId]),
    isStatus,
    `commitment_status did not return a status record for ${bondId}.`,
  );
}

export function getLedger(): Promise<ReadResult<Ledger>> {
  return performRead(
    () => callView("get_ledger"),
    isLedger,
    "get_ledger did not return a ledger record.",
  );
}

export function getLimits(): Promise<ReadResult<Limits>> {
  return performRead(
    () => callView("get_limits"),
    isLimits,
    "get_limits did not return a limits record.",
  );
}

export function schemaMismatch(method: string): ReadResult<never> {
  return invalidResponse(`The deployed contract does not expose ${method}.`);
}
