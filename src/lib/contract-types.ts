/**
 * The shapes the contract returns, as the frontend consumes them.
 *
 * Every field below was read off `contracts/Holdfast.py` rather than off the specification,
 * and the difference mattered: an earlier version of this file described a contract that does
 * not exist. It had a `stats` view the contract never had, keyed the status view by url when
 * the contract keys it by bond id, and named twenty fields the contract does not return. Every
 * read would have come back INVALID_RESPONSE. The rule that follows from that is written here
 * rather than remembered: this file mirrors the twelve methods, and `npm run verify:schema`
 * compares the method table against the deployed contract so the mirror cannot drift silently.
 *
 * Every `u256` arrives as a decimal string, because that is what calldata decoding produces.
 * Keeping them as strings rather than coercing at the boundary means a value too large for a JS
 * number cannot be quietly mangled on the way in. Exactly four fields arrive as real booleans:
 * `settled` on a bond, `qualified` and `text_truncated` on a change point, and `gate_a_enabled`
 * in the limits. They are typed as booleans and nothing else is.
 */

/** Consensus stages a write passes through, plus the retryable ones that are not failures. */
export type TxStage =
  | "UNINITIALIZED"
  | "PENDING"
  | "PROPOSING"
  | "COMMITTING"
  | "REVEALING"
  | "ACCEPTED"
  | "READY_TO_FINALIZE"
  | "APPEAL_COMMITTING"
  | "APPEAL_REVEALING"
  | "FINALIZED"
  | "UNDETERMINED"
  | "VALIDATORS_TIMEOUT"
  | "LEADER_TIMEOUT"
  | "CANCELED";

export type StoredTransaction = {
  hash: string;
  label: string;
  createdAt: string;
  status: TxStage;
  executionResult?: "SUCCESS" | "ROLLBACK" | "ERROR" | "UNKNOWN";
  executionError?: string;
  /** Added by the interface build. Older rows restored from storage may not carry them. */
  functionName?: string;
  bondId?: string;
};

/* ------------------------------------------------------------------------- *
 * Consensus stages
 * ------------------------------------------------------------------------- */

/** The stages a write walks in order, for the rail that draws one bar per stage. */
export const CONSENSUS_STAGES = [
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "FINALIZED",
] as const;

export type ConsensusStage = (typeof CONSENSUS_STAGES)[number];

/**
 * Stages that mean "try again", not "you were judged".
 *
 * A bond never moves on any of these, so the interface must not draw them in the same
 * register as a finding. They are the reel stopping, not the reel showing something.
 */
export const RETRYABLE_STAGES = new Set<TxStage>([
  "UNDETERMINED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

export const TERMINAL_STAGES = new Set<TxStage>(["FINALIZED", "CANCELED"]);

/** Client-side phases of one write. `settled` covers both an outcome and a refusal. */
export type WritePhase =
  | "idle"
  | "validating"
  | "wallet-pending"
  | "submitted"
  | "consensus-running"
  | "settled";

/* ------------------------------------------------------------------------- *
 * Bonds
 * ------------------------------------------------------------------------- */

/** `ST_ACTIVE` through `ST_RETURNED`, verbatim from `Holdfast.py:1700-1704`. */
export type BondState = "ACTIVE" | "BREACH_CLAIMED" | "CONTESTED" | "BREACHED" | "RETURNED";

export const BOND_STATES: readonly BondState[] = [
  "ACTIVE",
  "BREACH_CLAIMED",
  "CONTESTED",
  "BREACHED",
  "RETURNED",
] as const;

/** `""` until adjudication. `Holdfast.py:3017` and `Holdfast.py:3044` are the only writers. */
export type ContestOutcome = "" | "UPHELD" | "FAILED";

/**
 * One bond, all thirty-nine fields `get_bond` returns, in the order it returns them.
 *
 * `commitment` is the promisor's own sentence and is never regenerated, summarized or
 * rewritten. `baseline_digest` is recorded at creation precisely so a snapshot later withdrawn
 * from the archive cannot become a payout: the bond can no longer settle against evidence it
 * can no longer verify.
 *
 * Two fields need care at the call site. `promisor` and `payee` come from `Address.as_hex`,
 * which returns the EIP-55 checksummed form, so any comparison against a wallet address must
 * lowercase both sides. That exact mistake shipped three times in a sibling project before it
 * was caught, and it made every bond name a payee who could not act on it.
 */
export type Bond = {
  bond_id: string;
  /** Checksummed. Compare with `sameAddress`, never with `===`. */
  promisor: string;
  /** Checksummed. Compare with `sameAddress`, never with `===`. */
  payee: string;
  url: string;
  commitment: string;
  commitment_sha256: string;
  /**
   * Gate B's structural anchor, and it comes from the URL's last path segment rather than from
   * the commitment. `Holdfast.py:2050` derives it and refuses to accept it as an argument, on
   * the grounds that a promisor allowed to choose the phrase would choose one that appears in
   * any page the archive returns, a chrome-only shell included.
   */
  anchor: string;
  /** A JSON array string, exactly as `json.dumps` produced it: `["model","terms","content"]`. */
  anchor_words: string;
  anchor_terminal: string;

  baseline_timestamp: string;
  baseline_digest: string;
  baseline_encoding: EncodingKind;

  stake: string;
  term_days: string;
  created_at: string;
  expires_at: string;
  state: BondState;

  cursor_timestamp: string;
  last_checked_at: string;
  checks_passed: string;
  points_recorded: string;

  /** Consecutive qualified captures read as weakened or absent. Any HOLDS or INDETERMINATE resets it. */
  run_length: string;
  run_first_timestamp: string;

  breach_first_timestamp: string;
  breach_first_digest: string;
  breach_second_timestamp: string;
  breach_second_digest: string;
  /** Verbatim from the decoded bytes. A finding that cannot be quoted is not a finding. */
  breach_excerpt: string;
  breach_rationale: string;
  claimed_at: string;

  contest_deadline: string;
  contest_url: string;
  contest_timestamp: string;
  contest_bond: string;
  contest_outcome: ContestOutcome;
  contested_at: string;

  settled_at: string;
  settled: boolean;
  paid_to_payee: string;
  returned_to_promisor: string;
};

/** The eight fields `list_bonds` returns. Deliberately not a `Bond`, so a list cannot pretend to be one. */
export type BondSummary = {
  bond_id: string;
  url: string;
  state: BondState;
  stake: string;
  expires_at: string;
  cursor_timestamp: string;
  checks_passed: string;
  points_recorded: string;
};

/* ------------------------------------------------------------------------- *
 * Change points: one archived capture, examined
 * ------------------------------------------------------------------------- */

/**
 * Decided by magic bytes and nothing else: `1f8b` is gzip, a leading `78` is zlib, anything
 * else is treated as identity.
 *
 * There is no raw-deflate branch, and its absence is deliberate rather than an oversight.
 * `Holdfast.py:854` records why: across all eight captured payloads no payload needed one, six
 * being `1f8b` and two `3c21`, and a speculative raw-inflate attempt is worse than a decode
 * failure because it does not fail. Both measured non-deflate shapes come back from
 * `zlib.decompress(raw, -MAX_WBITS)` with one byte of output and no exception, so the branch
 * would produce a plausible empty document rather than an error, and every validator would agree
 * on it. `""` appears only on a point recorded before any decoding was reached.
 */
export type EncodingKind = "gzip" | "zlib" | "identity" | "";

/**
 * Which admissibility gates a capture failed, as a comma joined letter list.
 *
 * `""` means it passed all of the enabled ones. `A` is length against the median of the URL's own
 * change points and is off by default, for the one thing about the gates that was actually
 * measured: `cloud.google.com/terms/deprecation` extracted 2,738 characters in one capture and
 * 35,689 in another, a 13x inflation with no policy change, so gate A would have rejected the
 * unchanged page. `gate_a_enabled` in `Limits` is read rather than assumed, so the interface can
 * print which gates actually decided.
 *
 * B, C and D have no measured true positive, and this file says so rather than implying otherwise.
 * Every payload captured for this project qualifies once it is decoded. An earlier version of this
 * comment claimed they each caught 4 of 4 known-bad snapshots; that result came from a measuring
 * script that fetched the `id_` replay and never decompressed it, so four faithful gzip captures
 * were graded as binary. They are a fail-closed safeguard against a truncated or substituted
 * capture, which is a different and weaker claim.
 */
export type FailedGates = string;

export const GATE_TEXT: Record<"A" | "B" | "C" | "D", { label: string; meaning: string }> = {
  A: {
    label: "length against median",
    meaning:
      "The decoded text is far shorter than the median of this URL's own captures. Off by default: one page inflated from 2,738 to 35,689 characters with no policy change, so this gate would have rejected the unchanged version.",
  },
  B: {
    label: "title anchor",
    meaning: "The anchor phrase derived from the URL is absent, so this may not be the same document.",
  },
  C: {
    label: "section floor",
    meaning: "Too few of the document's expected sections were found for the capture to be a whole page.",
  },
  D: {
    label: "terminal marker",
    meaning:
      "The marker that should end the document is missing, so the capture may be truncated. The contract forces this marker to be independent of the anchor and every section, because a gate that cannot fail on its own is not a gate.",
  },
};

/** The model's single classification, `CL_HOLDS` through `CL_INDETERMINATE`. `""` when none was reached. */
export type CommitmentReading = "HOLDS" | "WEAKENED" | "ABSENT" | "INDETERMINATE";

/**
 * One examined capture, all fifteen fields `bond_history` returns, in order.
 *
 * A gate-rejected capture appears here with `qualified` false and an empty `classification`,
 * which is what lets the interface draw it as a blank frame rather than omitting it. A history
 * that listed only the captures that worked would make a gap in the evidence look like a clean
 * run.
 *
 * The converse is just as important and is easy to get wrong: a capture that could not be
 * fetched, whose stored-byte digest was checkable and did not check out, whose decoded pin no
 * longer reproduces, or whose reading came back unusable is NOT in this list at all.
 * `check_commitment` calls `_raise_if_error` on the admission block and lets `_classification_of`
 * raise, so any of those reverts the whole call and records nothing (`Holdfast.py:2791` and
 * `Holdfast.py:2804`). A gate rejection is therefore the only way a blank frame comes into
 * existence, and `encoding` is always a real encoding on a stored point, because the bytes had to
 * decode before a gate could run on them.
 *
 * Three fields a reader may expect are deliberately not here. There is no `digest_verified`, and
 * its absence is a real limit rather than a tidy omission. The CDX digest is over the record as the
 * archive STORED it, GenVM's transport undoes `Content-Encoding: gzip` before Python is handed the
 * body, and once the bytes arrive plain a mismatched digest and a transparently inflated record are
   * the same observation (`Holdfast.py:772`). So the contract records that state as `transport-decoded`
 * rather than refusing on it, does not carry it out through `bond_history`, and puts integrity on
 * `decoded_sha256`, which is pinned at baseline and has to reproduce on every later read of the same
 * timestamp. There is no per-point fault tag, because a rejected point carries `qualified: false`
 * plus `failed_gates`, and a point that was never recorded is reported by the write's own tagged
 * refusal instead. There is no `is_baseline`, because that is derived: compare `timestamp` against
 * the bond's `baseline_timestamp`.
 */
export type ChangePoint = {
  bond_id: string;
  /** 14 digits. Only an exact timestamp resolves; anything looser is a 302 and is refused. */
  timestamp: string;
  /**
   * base32 of sha1 over the bytes as the archive stored them, which are not always the bytes the
   * contract is handed. It self-verifies only when the transport left the record compressed. A
   * mismatch on plain bytes is unattributable and is not a refusal (`Holdfast.py:772`), so this
   * field is provenance and `decoded_sha256` is the integrity pin.
   */
  digest: string;
  raw_len: string;
  encoding: EncodingKind;
  decoded_sha256: string;
  /**
   * Characters of extracted visible text, not decoded bytes, and capped at 400,000 by
   * `PROMPT_TEXT_MAX_CHARS` before it is measured. A page that inflates to 372,058 bytes of HTML
   * lands here as roughly a tenth of that, so this is not the inflation figure and must never be
   * printed as one.
   */
  text_len: string;
  text_truncated: boolean;
  qualified: boolean;
  failed_gates: FailedGates;
  gate_c_hits: string;
  /**
   * One of the four words on a qualified point, and `""` only on a rejected one.
   *
   * Never `""` alongside `qualified: true`: `_classification_of` raises `[LLM_ERROR]` on an
   * answer outside the four words and on a breach finding whose quote is not in the document, so
   * an unusable reading reverts the check instead of storing a point with nothing in this field.
   */
  classification: CommitmentReading | "";
  /** Verbatim from the decoded body. A finding that cannot be located in the bytes fails closed. */
  excerpt: string;
  rationale: string;
  observed_at: string;
};

/** `bond_history` returns a flat list. There is no events view, so nothing here invents one. */
export type BondHistory = ChangePoint[];

/* ------------------------------------------------------------------------- *
 * Integration surface
 * ------------------------------------------------------------------------- */

/**
 * What `commitment_status(bond_id)` reports: tallies over the examined captures, and the two
 * numbers that decide whether a breach can be claimed.
 *
 * Deliberately not a boolean, and deliberately not a single verdict word. A two-state answer
 * forces every unknown into one of the two known answers, and the unknown here is the
 * dangerous one: an unreachable archive would have to render as either "holding" or "not
 * holding", and both are lies. `examined`, `qualified` and `gate_rejected` are reported
 * separately for the same reason a blank frame is not an empty frame. A bond with captures
 * examined and none qualified has established nothing, and this shape can say so.
 */
export type CommitmentStatus = {
  bond_id: string;
  state: BondState;
  url: string;
  commitment: string;
  baseline_timestamp: string;
  cursor_timestamp: string;
  last_checked_at: string;
  expires_at: string;
  /** Every capture the contract looked at, admitted or not. */
  examined: string;
  /** Those that passed the gates. Only these are ever read. */
  qualified: string;
  /** Those that did not. Never evidence about the commitment in either direction. */
  gate_rejected: string;
  holds: string;
  weakened: string;
  absent: string;
  indeterminate: string;
  run_length: string;
  breach_run_needed: string;
  last_qualified_timestamp: string;
};

/** Every wei in and out, from `get_ledger`. The fee is zero by construction, and is reported anyway. */
export type Ledger = {
  total_escrowed: string;
  total_paid_to_payees: string;
  total_returned_to_promisors: string;
  bonds_created: string;
  checks_run: string;
  breaches_claimed: string;
  contests_filed: string;
  fee_basis_points: string;
};

/** The bounds `get_limits` publishes, so a client can refuse a bad bond before it costs anything. */
export type Limits = {
  min_term_days: string;
  max_term_days: string;
  min_commitment_chars: string;
  max_commitment_chars: string;
  min_anchor_words: string;
  max_anchor_words: string;
  min_change_points: string;
  breach_run_length: string;
  check_interval_seconds: string;
  contest_window_seconds: string;
  contest_bond_basis_points: string;
  cdx_warc_length_max: string;
  raw_max_bytes: string;
  decoded_max_bytes: string;
  max_points_per_check: string;
  gate_a_enabled: boolean;
};

/* ------------------------------------------------------------------------- *
 * Wording, in one place
 * ------------------------------------------------------------------------- */

/**
 * Every state pairs a meaning with a limit, because a state that only says what it proves
 * invites a reader to supply the rest themselves.
 */
export const BOND_STATE_TEXT: Record<BondState, { meaning: string; limit: string }> = {
  ACTIVE: {
    meaning: "The stake is escrowed and no qualified capture has shown the commitment weakening.",
    limit: "This describes the archived record of one page. It is not a statement about conduct.",
  },
  BREACH_CLAIMED: {
    meaning:
      "Two consecutive qualified captures read as weakened. The stake is held and the contest window is open.",
    limit: "Nothing has been paid out. The promisor may still show the commitment moved.",
  },
  CONTESTED: {
    meaning: "The promisor cited archived evidence against the claim and posted a contest bond.",
    limit: "The contest is read against the archive only. Intent and materiality are out of scope.",
  },
  BREACHED: {
    meaning: "The claim survived the window or the contest failed. The stake went to the payee.",
    limit: "The finding is a reading of archived text, quoted from it, not a legal determination.",
  },
  RETURNED: {
    meaning: "The term ran out with the commitment intact across every qualified capture, and the stake went back.",
    limit:
      "The published wording did not weaken. It does not follow that the promise was kept in practice.",
  },
};

export const READING_TEXT: Record<CommitmentReading, { meaning: string; limit: string }> = {
  HOLDS: {
    meaning: "A commitment at least as strong as the quoted one is present in this capture.",
    limit: "Restating a commitment in different words holds. Only a weakening counts against a bond.",
  },
  WEAKENED: {
    meaning: "The capture carries a version of the commitment that is narrower than the quoted one.",
    limit: "One weakened capture moves nothing. Two consecutive qualified ones are required.",
  },
  ABSENT: {
    meaning: "The capture no longer discusses the subject of the commitment at all.",
    limit: "Absent from this URL is not proof of abandonment. The commitment may have moved.",
  },
  INDETERMINATE: {
    meaning: "The validators did not agree on a single reading of this capture.",
    limit: "No state change. An unresolved reading is not a finding and is never treated as one.",
  },
};

export const CONTEST_OUTCOME_TEXT: Record<Exclude<ContestOutcome, "">, { meaning: string; limit: string }> = {
  UPHELD: {
    meaning: "The cited capture carried a commitment at least as strong, so the bond returned to active.",
    limit: "The contest bond was returned. The earlier breach claim is recorded, not erased.",
  },
  FAILED: {
    meaning: "The cited capture did not carry a commitment at least as strong, so the claim stood.",
    limit: "The contest bond was forfeited along with the stake. The reading is quoted from the capture.",
  },
};

export const ENCODING_TEXT: Record<EncodingKind, string> = {
  gzip: "magic bytes 1f8b, inflated before any text was extracted",
  zlib: "magic byte 78, inflated before any text was extracted",
  identity: "no compression, the replay is the payload",
  "": "no encoding recorded, so nothing was read from these bytes",
};

/* ------------------------------------------------------------------------- *
 * The client mirror of the contract's bounds, and the check that it is still a mirror
 * ------------------------------------------------------------------------- */

/**
 * Enough of `get_limits` to refuse a bad bond synchronously, before a wallet opens.
 *
 * These are duplicated numbers and duplication is a liability, so it is bounded two ways. The
 * contract is the authority and every page reads `get_limits()` for anything it prints. These
 * are used only by the synchronous validator, which cannot await. And `limitsDrift` below
 * compares the two whenever both are in hand, so a divergence surfaces as a named
 * disagreement rather than as a form that accepts something the chain then refuses.
 */
export const CLIENT_LIMITS = {
  commitmentMin: 40,
  commitmentMax: 400,
  anchorWordsMin: 3,
  anchorWordsMax: 12,
  anchorWordMin: 3,
  anchorWordMax: 64,
  termDaysMin: 30,
  termDaysMax: 1095,
  termDaysDefault: 365,
  checkIntervalHours: 24,
  contestWindowDays: 7,
  contestBondPct: 10,
  breachRunLength: 2,
  minChangePoints: 3,
  maxPointsPerCheck: 8,
  cdxLengthCap: 250000,
  rawCap: 2500000,
  decodedCap: 4000000,
  /** Byte-exact payload proven to survive a StudioNet consensus block. */
  consensusEnvelope: 5647099,
} as const;

/** One disagreement between the mirror above and what the contract actually published. */
export type LimitsDisagreement = {
  field: string;
  client: number;
  contract: number;
};

/**
 * Every field where the client mirror and the contract disagree, as numbers.
 *
 * Returns an empty array when they agree, which is the case this is written to keep true. The
 * seconds-to-hours and basis-points-to-percent conversions are done here rather than at the
 * comparison sites, because a unit mismatch is exactly the kind of drift this exists to catch.
 */
export function limitsDrift(contract: Limits): LimitsDisagreement[] {
  const pairs: Array<[string, number, number]> = [
    ["commitmentMin", CLIENT_LIMITS.commitmentMin, Number(contract.min_commitment_chars)],
    ["commitmentMax", CLIENT_LIMITS.commitmentMax, Number(contract.max_commitment_chars)],
    ["anchorWordsMin", CLIENT_LIMITS.anchorWordsMin, Number(contract.min_anchor_words)],
    ["anchorWordsMax", CLIENT_LIMITS.anchorWordsMax, Number(contract.max_anchor_words)],
    ["termDaysMin", CLIENT_LIMITS.termDaysMin, Number(contract.min_term_days)],
    ["termDaysMax", CLIENT_LIMITS.termDaysMax, Number(contract.max_term_days)],
    ["minChangePoints", CLIENT_LIMITS.minChangePoints, Number(contract.min_change_points)],
    ["breachRunLength", CLIENT_LIMITS.breachRunLength, Number(contract.breach_run_length)],
    ["maxPointsPerCheck", CLIENT_LIMITS.maxPointsPerCheck, Number(contract.max_points_per_check)],
    ["cdxLengthCap", CLIENT_LIMITS.cdxLengthCap, Number(contract.cdx_warc_length_max)],
    ["rawCap", CLIENT_LIMITS.rawCap, Number(contract.raw_max_bytes)],
    ["decodedCap", CLIENT_LIMITS.decodedCap, Number(contract.decoded_max_bytes)],
    ["checkIntervalHours", CLIENT_LIMITS.checkIntervalHours, Number(contract.check_interval_seconds) / 3600],
    ["contestWindowDays", CLIENT_LIMITS.contestWindowDays, Number(contract.contest_window_seconds) / 86400],
    ["contestBondPct", CLIENT_LIMITS.contestBondPct, Number(contract.contest_bond_basis_points) / 100],
  ];
  const out: LimitsDisagreement[] = [];
  for (const [field, client, value] of pairs) {
    if (!Number.isFinite(value) || client !== value) {
      out.push({ field, client, contract: value });
    }
  }
  return out;
}

/**
 * The bounds the interface actually uses, in the units it prints them in.
 *
 * `actions.ts` and `validate.ts` take one of these rather than reaching for `CLIENT_LIMITS`
 * directly, so the contract's own numbers reach the buttons and the form whenever
 * `get_limits()` has answered. `source` records which answer this is, and the pages print it,
 * because a validator running on a mirror while the contract has moved on is a thing a reader
 * is entitled to know about before they sign.
 *
 * The four fields with no contract equivalent are `anchorWordMin` and `anchorWordMax`, which bound
 * one entry rather than the count, `termDaysDefault`, which is a form default and not a rule, and
 * `consensusEnvelope`, which is a measurement of StudioNet rather than a contract constant. Those
 * stay on the mirror in either case and are labelled as client-side in the form.
 *
 * The numeric fields are widened to `number` deliberately. `CLIENT_LIMITS` is `as const`, so
 * `typeof` alone would type `commitmentMin` as the literal `40` and make a resolved limit from the
 * contract unassignable to it, which is the opposite of the point: these values exist to be
 * replaced by what `get_limits()` published.
 */
export type ResolvedLimits = {
  -readonly [K in keyof typeof CLIENT_LIMITS]: number;
} & { source: "contract" | "client" };

/**
 * The contract's limits record, converted once.
 *
 * Seconds become hours and days, basis points become a percent, and every field arrives as a
 * number, so no call site has to remember which unit `get_limits` published. Passing nothing
 * yields the mirror, which is what the create form uses before its first read resolves.
 */
export function resolveLimits(contract?: Limits): ResolvedLimits {
  if (!contract) return { ...CLIENT_LIMITS, source: "client" };
  const num = (value: string, fallback: number) => {
    // An empty field falls back rather than resolving to zero. `Number("")` is `0`, which is finite,
    // so without the guard a limit the contract published as empty would become a bound of nothing
    // and the form would accept anything. `limitsDrift` still reports the field either way.
    const parsed = (value ?? "").trim() === "" ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    ...CLIENT_LIMITS,
    commitmentMin: num(contract.min_commitment_chars, CLIENT_LIMITS.commitmentMin),
    commitmentMax: num(contract.max_commitment_chars, CLIENT_LIMITS.commitmentMax),
    anchorWordsMin: num(contract.min_anchor_words, CLIENT_LIMITS.anchorWordsMin),
    anchorWordsMax: num(contract.max_anchor_words, CLIENT_LIMITS.anchorWordsMax),
    termDaysMin: num(contract.min_term_days, CLIENT_LIMITS.termDaysMin),
    termDaysMax: num(contract.max_term_days, CLIENT_LIMITS.termDaysMax),
    checkIntervalHours: num(contract.check_interval_seconds, 86400) / 3600,
    contestWindowDays: num(contract.contest_window_seconds, 604800) / 86400,
    contestBondPct: num(contract.contest_bond_basis_points, 1000) / 100,
    breachRunLength: num(contract.breach_run_length, CLIENT_LIMITS.breachRunLength),
    minChangePoints: num(contract.min_change_points, CLIENT_LIMITS.minChangePoints),
    maxPointsPerCheck: num(contract.max_points_per_check, CLIENT_LIMITS.maxPointsPerCheck),
    cdxLengthCap: num(contract.cdx_warc_length_max, CLIENT_LIMITS.cdxLengthCap),
    rawCap: num(contract.raw_max_bytes, CLIENT_LIMITS.rawCap),
    decodedCap: num(contract.decoded_max_bytes, CLIENT_LIMITS.decodedCap),
    source: "contract",
  };
}

/**
 * Address comparison that survives EIP-55.
 *
 * `get_bond` returns `Address.as_hex`, which is checksummed, and a wallet may report any
 * casing. Comparing those two with `===` is how a sibling project shipped three deployments in
 * which no payee could act on their own bond.
 */
export function sameAddress(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
