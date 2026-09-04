/**
 * One write, described twice: what the client is doing, and what the contract is doing.
 *
 * The two lists are separate on purpose. The client phases are about a person and their
 * wallet, and exactly two of them cost a signature. The program steps are about the chain,
 * and each one declares whether it is arithmetic, a fetch, or a reading. That last field is
 * the whole reason this file exists: it is what lets the interface name the source being
 * fetched instead of showing a spinner, and it is what makes the boundary between counted
 * bytes and read meaning visible on the screen rather than in a footnote.
 */

import type { WritePhase } from "./contract-types.ts";

export type PhaseKey = WritePhase;

export type ClientPhase = {
  key: PhaseKey;
  label: string;
  detail: string;
  costsSignature: boolean;
};

export const CLIENT_PHASES: ClientPhase[] = [
  {
    key: "validating",
    label: "Checking the request",
    detail:
      "Field by field, against the bounds the contract enforces. Anything it would refuse is refused here first, for free.",
    costsSignature: false,
  },
  {
    key: "wallet-pending",
    label: "Waiting for your signature",
    detail: "Your wallet has the method and the amount. Dismissing it returns here with your input intact.",
    costsSignature: true,
  },
  {
    key: "submitted",
    label: "Submitted",
    detail: "The transaction hash exists from this moment and is shown as soon as it does.",
    costsSignature: true,
  },
  {
    key: "consensus-running",
    label: "Advancing the reel",
    detail:
      "Validators fetch the index and the snapshots independently. Frames arrive as captures resolve, oldest first.",
    costsSignature: false,
  },
  {
    key: "settled",
    label: "Finalized",
    detail: "The leader receipt is in. What it says is printed below, including when it says nothing.",
    costsSignature: false,
  },
];

/* ------------------------------------------------------------------------- *
 * Programs of work
 * ------------------------------------------------------------------------- */

export type StepKind = "deterministic" | "network" | "inference";

export type ProgramStep = {
  key: string;
  label: string;
  detail: string;
  /** Named, always. A row with no named source is a row that should not be drawn. */
  source: string;
  kind: StepKind;
};

export const STEP_KIND_TEXT: Record<StepKind, string> = {
  deterministic: "arithmetic on bytes the contract already holds",
  network: "one fetch, agreed byte for byte across validators",
  inference: "a reading of text, bounded and quoted from the document",
};

/** `check_commitment`: the core path, and the one a stranger can call. */
export const CHECK_PROGRAM: ProgramStep[] = [
  {
    key: "guards",
    label: "State, term and interval guards",
    detail:
      "The bond must be active, inside its term, and at least 24 hours past its last check. Refused before any fetch.",
    source: "bond storage",
    kind: "deterministic",
  },
  {
    key: "cdx",
    label: "Index query from the cursor",
    detail:
      "Date bounded and limited. A page with 262,950 change points is why the bond carries a cursor rather than a full history.",
    source: "web.archive.org/cdx/search/cdx",
    kind: "network",
  },
  {
    key: "rows",
    label: "Row count",
    detail:
      "A URL that was never archived answers 200 with a 3 byte body. Zero rows is an unreachable archive, never an unchanged page.",
    source: "the index response",
    kind: "deterministic",
  },
  {
    key: "length-cap",
    label: "Index length cap",
    detail:
      "The index reports the compressed record length. 250,000 is the ceiling, because the worst measured expansion to raw payload was 7.84 times.",
    source: "the index rows",
    kind: "deterministic",
  },
  {
    key: "replay",
    label: "Raw snapshot replay",
    detail:
      "The id_ replay at the exact 14 digit timestamp. Off by one second returns a 302, and a redirect is never followed into a substitute.",
    source: "web.archive.org/web/{timestamp}id_/",
    kind: "network",
  },
  {
    key: "digest",
    label: "SHA-1 against the index digest, where it can be read",
    detail:
      "base32 of sha1 over the bytes as the archive stored them, which are not always the bytes the contract is handed. It self-verifies only while the record arrives still compressed. Once the transport has inflated it, a mismatch and a faithful record are the same observation, so that state is recorded rather than refused and the hash of the decoded body, pinned at the baseline and required to reproduce on every later read of the same timestamp, is what carries the integrity.",
    source: "the stored payload",
    kind: "deterministic",
  },
  {
    key: "decode",
    label: "Encoding by magic bytes, then decode",
    detail:
      "Three branches: 1f8b gzip, 78 zlib, else identity. There is no raw deflate branch, and its absence is the point, because a false positive there would produce plausible bytes rather than an error and every validator would agree on a document that does not exist.",
    source: "the first bytes of the payload",
    kind: "deterministic",
  },
  {
    key: "gates",
    label: "Admissibility gates A, B, C and D",
    detail:
      "Title anchor, section floor and terminal marker, each matched on normalized text. They are a fail-closed safeguard and not a measured detector: every payload captured for this project qualifies once it is decoded, so B, C and D have no measured true positive. Gate A is off, for the one thing that was measured: chrome inflated one page from 2,738 to 35,689 characters with no policy change, so a length floor rejects the faithful capture and admits the broken one.",
    source: "the decoded text",
    kind: "deterministic",
  },
  {
    key: "reading",
    label: "Does the commitment still hold",
    detail:
      "Asked only of a capture that already qualified, and asked for a verbatim excerpt. It is never asked whether the bond should pay.",
    source: "the quoted commitment against the decoded text",
    kind: "inference",
  },
  {
    key: "corroborate",
    label: "Two consecutive qualified captures",
    detail:
      "One weakened capture moves nothing. A capture that failed the gate is skipped, and skipping breaks consecutiveness.",
    source: "the examined change points",
    kind: "deterministic",
  },
  {
    key: "record",
    label: "Advance the cursor, record the walk",
    detail:
      "Written once, at the end, and only if the whole walk succeeded. A capture that failed the gates is recorded as a blank frame. A capture that could not be retrieved, or whose decoded hash no longer reproduces the baseline pin, reverts the entire call, including the frames already walked in it, so a check either lands whole or lands not at all.",
    source: "bond storage",
    kind: "deterministic",
  },
];

/** `create_bond`: qualifies the baseline before accepting a single wei. */
export const CREATE_PROGRAM: ProgramStep[] = [
  {
    key: "validate",
    label: "URL, commitment, anchors, payee, stake and term",
    detail:
      "https only, no fragment, no credentials, no port. 40 to 400 characters of commitment. Payee not the promisor.",
    source: "your input",
    kind: "deterministic",
  },
  {
    key: "cdx",
    label: "Index query for the baseline window",
    detail: "The nominated timestamp must appear in the rows with statuscode 200, and there must be at least 3 change points in the trailing year.",
    source: "web.archive.org/cdx/search/cdx",
    kind: "network",
  },
  {
    key: "replay",
    label: "Raw snapshot replay at the exact timestamp",
    detail: "Capped at 2,500,000 raw bytes and 4,000,000 decoded, against a proven consensus envelope of 5,647,099.",
    source: "web.archive.org/web/{timestamp}id_/",
    kind: "network",
  },
  {
    key: "verify",
    label: "Digest, decode and gates",
    detail: "The same arithmetic every later check will run, so a baseline that cannot be qualified is never bonded.",
    source: "the raw payload",
    kind: "deterministic",
  },
  {
    key: "present",
    label: "Is the quoted commitment present in the baseline",
    detail: "A bond cannot be staked on a sentence the archived document does not contain.",
    source: "the quoted commitment against the decoded text",
    kind: "inference",
  },
  {
    key: "escrow",
    label: "Record the baseline digests, escrow the stake",
    detail:
      "The digest, raw length and decoded hash are stored now, so a capture later withdrawn from the archive cannot be settled against.",
    source: "bond storage",
    kind: "deterministic",
  },
];

/**
 * `contest_breach`: filing, which is entirely deterministic.
 *
 * Nothing is fetched and no model is asked here. `Holdfast.py:2902` says why: adjudication is a
 * separate permissionless call, so a promisor cannot file a contest and then decline to have it
 * judged. An earlier version of this file gave filing the settlement program, which described
 * moving the stake. Filing moves no stake and takes one.
 */
export const CONTEST_FILING_PROGRAM: ProgramStep[] = [
  {
    key: "guards",
    label: "State, caller and window guards",
    detail:
      "The bond must carry an open claim, the caller must be its promisor, and the contest window must still be open. This is the one write on this contract a stranger cannot make.",
    source: "bond storage",
    kind: "deterministic",
  },
  {
    key: "citation",
    label: "The cited URL and timestamp",
    detail:
      "Held to the same standards as the bonded URL: https only, printable ASCII, no fragment, and a timestamp of exactly 14 digits. Nothing is fetched to check them.",
    source: "your input",
    kind: "deterministic",
  },
  {
    key: "bond",
    label: "The contest bond",
    detail:
      "1,000 basis points of the stake, exact integer arithmetic. A call carrying less is refused with both figures named.",
    source: "the stake in escrow",
    kind: "deterministic",
  },
  {
    key: "file",
    label: "Record the citation, escrow the bond",
    detail:
      "The bond becomes contested and the citation is stored. It is judged when anyone calls the adjudication, which is the next row of this table and not this one.",
    source: "bond storage",
    kind: "deterministic",
  },
];

/** `adjudicate_contest`: narrow, and it cannot revisit the finding. */
export const CONTEST_PROGRAM: ProgramStep[] = [
  {
    key: "guards",
    label: "State guard",
    detail: "The bond must be contested. Anyone may make this call, the payee included.",
    source: "bond storage",
    kind: "deterministic",
  },
  {
    key: "member",
    label: "Index membership of the cited capture",
    detail:
      "The promisor's timestamp must appear in the index for the promisor's URL. A citation the archive does not carry is refused before it is fetched.",
    source: "web.archive.org/cdx/search/cdx",
    kind: "network",
  },
  {
    key: "replay",
    label: "Replay the cited capture",
    detail: "The promisor's own URL and timestamp, verified by the same digest arithmetic as everything else.",
    source: "web.archive.org/web/{timestamp}id_/",
    kind: "network",
  },
  {
    key: "gates",
    label: "Digest, decode and gates on the cited capture",
    detail: "Contested evidence is held to the same admissibility standard as the evidence it answers.",
    source: "the raw payload",
    kind: "deterministic",
  },
  {
    key: "reading",
    label: "Is a commitment at least as strong present here",
    detail:
      "That single question and nothing else. The reading cannot revisit the breach finding, change the stake, or add a ground.",
    source: "the cited capture against the original commitment",
    kind: "inference",
  },
  {
    key: "resolve",
    label: "Restore, forfeit, or stay stuck",
    detail:
      "Reads as holding: the contest bond comes back and the bond returns to active. Reads as weakened or absent: the stake and the contest bond both go to the payee. Reads as neither: the call reverts, nobody is paid, and the bond stays contested until someone calls again. Forfeiting a stake because a model could not tell is what this contract exists to refuse.",
    source: "bond storage",
    kind: "deterministic",
  },
];

/**
 * `settle_breach`: the only settlement that re-fetches.
 *
 * It is not a deterministic write, which is what an earlier version of this file called it.
 * `Holdfast.py:3062` re-fetches both cited captures using the digest and index length recorded at
 * claim time and no fresh index call, because without that a capture that qualified once could be
 * settled against forever, including after the only copy of it stopped existing.
 */
export const SETTLE_PROGRAM: ProgramStep[] = [
  {
    key: "guards",
    label: "State and deadline guards",
    detail:
      "The claim must be open and uncontested, and the contest window must have closed. Arithmetic on stored values only.",
    source: "bond storage",
    kind: "deterministic",
  },
  {
    key: "replay",
    label: "Re-fetch both cited captures",
    detail:
      "At their exact recorded timestamps, with no fresh index query. The stored digest and index length are the inputs, so this is a claim about retrievable evidence and not about a row the contract wrote down for itself.",
    source: "web.archive.org/web/{timestamp}id_/",
    kind: "network",
  },
  {
    key: "requalify",
    label: "Gates again, on both",
    detail:
      "A capture that no longer qualifies cannot be settled against, and a capture that now hashes to something else is a disagreement rather than a finding. Either way the settlement refuses and the stake stays escrowed.",
    source: "the raw payloads",
    kind: "deterministic",
  },
  {
    key: "transfer",
    label: "Move the stake",
    detail: "The whole stake to the payee. One path, no discretion, no fee.",
    source: "escrow",
    kind: "deterministic",
  },
];

/** `expire_bond`: the deterministic write. No fetch, no reading, nothing to name. */
export const EXPIRE_PROGRAM: ProgramStep[] = [
  {
    key: "guards",
    label: "State and term guards",
    detail:
      "Only an active bond expires, and only after its own end date. A claimed breach settles or is contested, and neither is a timeout, so the promisor cannot run the clock out past a live claim.",
    source: "bond storage",
    kind: "deterministic",
  },
  {
    key: "transfer",
    label: "Return the stake",
    detail:
      "The whole stake to the promisor. Nothing is re-fetched, because nothing is being claimed: the term ended with every capture that qualified still carrying the commitment.",
    source: "escrow",
    kind: "deterministic",
  },
];

/**
 * There is no `renew_bond` row, because there is no such method.
 *
 * `Holdfast.py:3137` leaves it out and says why: renewal re-anchors the term against a new
 * baseline, which is the one operation that changes what a payout is measured against, and no test
 * in the suite exercises it. A program of work for a method that does not exist would print a
 * plausible table and then fail at the node after the wallet had already opened.
 */
export const PROGRAMS: Record<string, ProgramStep[]> = {
  create_bond: CREATE_PROGRAM,
  check_commitment: CHECK_PROGRAM,
  contest_breach: CONTEST_FILING_PROGRAM,
  adjudicate_contest: CONTEST_PROGRAM,
  settle_breach: SETTLE_PROGRAM,
  expire_bond: EXPIRE_PROGRAM,
};

/**
 * Returns undefined for an unknown method rather than a default program.
 *
 * The previous default returned the settlement steps for anything unrecognised, which meant a
 * typo in a method name printed a confident and wrong description of what was about to happen.
 */
export function programFor(functionName: string): ProgramStep[] | undefined {
  return PROGRAMS[functionName];
}

/* ------------------------------------------------------------------------- *
 * Outcomes
 * ------------------------------------------------------------------------- */

export type OutcomeClass = "finding" | "expected" | "external" | "transient" | "llm-error";

/**
 * `strip` and `lightTable` are the two things the signature element does in each case, and
 * they are part of the outcome rather than decided at the render site, so the blank frame
 * cannot drift away from the state that requires it.
 */
export type Outcome = {
  tag: string;
  headline: string;
  body: string;
  strip: string;
  lightTable: string;
  retry: boolean;
};

export const OUTCOMES: Record<Exclude<OutcomeClass, "finding">, Outcome> = {
  expected: {
    tag: "[EXPECTED]",
    headline: "The request was refused",
    body:
      "The contract declined this call on its own terms. Your input is unchanged below, no stake moved, and no archive was touched.",
    strip: "Unchanged. The reel did not advance.",
    lightTable: "Unchanged. The baseline excerpt is still the only reading shown.",
    retry: false,
  },
  external: {
    tag: "[EXTERNAL]",
    headline: "The archive could not be read",
    body:
      "A capture the index named could not be retrieved, or the index answered with nothing newer than the cursor. Either way no document was examined, so the call reverted and the bond is untouched. An unreachable archive is never an intact commitment and never a broken one.",
    strip: "The reel stops at the last recorded frame. Nothing was added, including the captures this call had already walked.",
    lightTable: "Unchanged. There is no new reading to open.",
    retry: true,
  },
  transient: {
    tag: "[TRANSIENT]",
    headline: "Validators fetched different bytes",
    body:
      "The digests did not agree across validators, which means they did not read the same capture. The call reverted rather than resolving a disagreement into a result. Running it again is safe and is the expected next step.",
    strip: "The reel stops at the last agreed frame. Nothing was recorded.",
    lightTable: "Unchanged.",
    retry: true,
  },
  "llm-error": {
    tag: "[LLM_ERROR]",
    headline: "The reading failed closed",
    body:
      "Either the model's output could not be parsed, or it cited an excerpt that is not present in the decoded bytes. A finding that cannot be quoted from the document is not a finding, so the bond did not move.",
    strip: "The reel stops. No frame is double ruled.",
    lightTable: "Opens empty. A failed reading shows nothing rather than something.",
    retry: true,
  },
};

/**
 * What a blank frame means, in one place, because it belongs to no error class.
 *
 * A blank frame is the record of a gate rejection on a call that SUCCEEDED. It is the only failure
 * this contract writes down. Every other one reverts: an unreachable capture, a digest that does
 * not match the index, a decode that fails its cap, a model answer that cannot be used. Those
 * record nothing at all, so the strip has no frame for them and stops instead.
 *
 * The consequence is worth stating on screen wherever a blank frame appears, because the intuitive
 * reading of an empty frame is "something went wrong here" and the true reading is narrower: the
 * bytes arrived, they verified against the index, and they were not the document they claimed to
 * be. That is a skip, and a skip breaks a run rather than counting as a loss.
 */
export const BLANK_FRAME_MEANING =
  "A blank frame is a capture that arrived and verified, then failed a gate. It is the only failure written down, and it is never counted as the commitment weakening.";

/** The success wording, which carries its own limit in the same sentence group. */
export function heldHeadline(checksPassed: string, captures: number): { headline: string; limit: string } {
  return {
    headline:
      captures === 1
        ? "The commitment was unchanged across 1 archived capture."
        : `The commitment was unchanged across ${captures} archived captures.`,
    limit:
      "This does not mean the promise was kept in practice, only that the published wording did not weaken. " +
      `Checks passed: ${checksPassed}.`,
  };
}
