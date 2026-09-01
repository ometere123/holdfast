/**
 * The contract's own deterministic validation, mirrored so the client can refuse for free.
 *
 * Every rule here exists in the contract too. The point of the copy is not to be the
 * authority; it is that a refusal costs nothing before a signature and costs a transaction after
 * one. It used to cost more than that. `create_bond` reverted on every refusal, and a GenVM revert
 * undoes the storage writes without undoing the transfer that funded the call, so a refusal on the
 * far side of a signature stranded the stake. That was measured on chain, and `create_bond` is now
 * a refusal boundary: it refunds and returns the tagged sentence instead of raising it
 * (`Holdfast.py:2506` records both the old argument and why it was insufficient).
 *
 * So these functions are no longer the thing standing between a typo and a lost stake. What they
 * still do is turn a mistake into no transaction at all rather than a refunded one, which is worth
 * having: the refund arrives at finality, not immediately, and the round trip costs the caller a
 * signature and a wait for an answer this file already knows.
 *
 * Where the two ever disagree the contract is right, which is why nothing below is phrased as a
 * guarantee that the write will succeed. Five rules were wrong in an earlier version of this file
 * and each one would have sent a call that came back refused:
 *
 *   - the commitment length was measured after trimming, and the contract measures the raw string
 *     (`Holdfast.py:2112`), so a pasted sentence with a trailing newline passed here at 400 and
 *     was refused there at 401;
 *   - the anchor list was split on whitespace, and the contract takes a JSON array whose entries
 *     may each be up to 64 characters (`Holdfast.py:2101`), so a section called "customer content"
 *     was sent as two entries;
 *   - duplicate anchor entries were accepted here and refused there (`Holdfast.py:2106`);
 *   - gate B's anchor was not checked at all, and it is derived from the URL, so a URL with no
 *     usable final path segment is unbondable for a reason no form field could have shown
 *     (`Holdfast.py:2562`). A trailing slash is not itself the problem: the contract walks back to
 *     the last non-empty segment, so `/legal/` derives "legal" and is fine. A bare host derives
 *     nothing, and a final segment that normalizes to under three characters is too weak to look
 *     for in a document;
 *   - gate D's terminal marker was checked for length and nothing else, and the contract also
 *     refuses one that overlaps the anchor or any section (`Holdfast.py:1210`), which is the rule
 *     least likely to be guessed and sits behind the stake.
 *
 * The bounds come from `get_limits()` through `resolveLimits`, so a constant that moves in the
 * contract moves the form. The three values with no contract equivalent are marked where used.
 */

import type { ResolvedLimits } from "./contract-types.ts";
import { resolveLimits } from "./contract-types.ts";
import { deriveAnchor, genToWei, isArchiveTimestamp, normalizeText } from "./format.ts";

export type FieldError = { field: string; message: string };

/**
 * The eight arguments `create_bond` takes, in the form's own units.
 *
 * `bondId` is one of them and is not generated for the promisor. The contract refuses a duplicate
 * id and refuses a second bond over the same url and commitment pair, so the id is a name the
 * promisor chooses and has to be able to see.
 *
 * `anchorEntries` is newline separated in the form and becomes a JSON array on the way out.
 */
export type BondDraft = {
  bondId: string;
  url: string;
  commitment: string;
  anchorEntries: string;
  anchorTerminal: string;
  baselineTimestamp: string;
  payee: string;
  stake: string;
  termDays: string;
};

/** `termDays` is a form default and not a contract rule, which is why it is the only one seeded. */
export function emptyDraft(limits: ResolvedLimits = resolveLimits()): BondDraft {
  return {
    bondId: "",
    url: "",
    commitment: "",
    anchorEntries: "",
    anchorTerminal: "",
    baselineTimestamp: "",
    payee: "",
    stake: "",
    termDays: String(limits.termDaysDefault),
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;

/** `MAX_BOND_ID` and the URL, terminal and normalized-commitment bounds have no `get_limits` entry. */
const MAX_BOND_ID_CHARS = 64;
const MAX_URL_CHARS = 400;
const MAX_TERMINAL_CHARS = 120;
const MIN_COMMITMENT_NORM_CHARS = 20;
const MIN_DERIVED_ANCHOR_CHARS = 3;

export function checkBondId(raw: string): string {
  const value = raw.trim();
  if (!value) return "An id is required. It is how this bond is addressed in every later call.";
  if (value.length > MAX_BOND_ID_CHARS) {
    return `An id is at most ${MAX_BOND_ID_CHARS} characters. This one is ${value.length}.`;
  }
  return "";
}

/**
 * https only, no fragment, no credentials, no port, printable ASCII, 400 characters.
 *
 * Each of those is the contract's, and each has a reason recorded at `Holdfast.py:2017`. The
 * fragment and the credentials are refused because the archive indexes neither, so a URL carrying
 * them would be bonded against a page the contract can never fetch. A port is refused for the same
 * reason: the CDX index does not resolve one. ASCII is refused because a percent-encoded IDN and
 * its unicode form are the same page under two different CDX keys.
 *
 * The ASCII test runs on the raw string rather than on the parsed URL, because `new URL` punycodes
 * an IDN host and would report an ASCII hostname for a string the contract rejects.
 */
export function checkUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "A URL is required. It is the page the archive will be read from.";
  if (value.length > MAX_URL_CHARS) {
    return `A URL is at most ${MAX_URL_CHARS} characters. This one is ${value.length}.`;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code > 126) {
      return `The URL must be printable ASCII. ${JSON.stringify(character)} is not, and a percent encoded host and its unicode form reach the archive as two different keys.`;
    }
  }
  if (!value.startsWith("https://")) {
    return "The URL must use https. An http fetch is a different document to every validator sitting behind a different middlebox.";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "That is not a URL the archive could resolve. It needs a scheme and a host.";
  }
  if (value.includes("#")) {
    return "Remove the fragment. The archive indexes pages, not positions inside them.";
  }
  if (parsed.username || parsed.password) return "Remove the credentials from the URL.";
  if (parsed.port) return "Remove the port. The index does not resolve one.";
  if (!parsed.hostname.includes(".")) return "The host does not look like a dotted public name.";
  return "";
}

/**
 * Gate B's anchor, checked without being asked for.
 *
 * This is the one field the promisor cannot fill in. The contract derives it from the URL's last
 * path segment and refuses to accept it as an argument, on the grounds that a promisor allowed to
 * choose the phrase would choose one that appears in any page the archive returns, a chrome-only
 * shell included. So the form shows what was derived, and refuses the URL when nothing usable
 * comes out of it, with the same reason the contract gives.
 */
export function checkDerivedAnchor(rawUrl: string): string {
  const anchor = deriveAnchor(rawUrl.trim());
  const normalized = normalizeText(anchor);
  if (normalized.length < MIN_DERIVED_ANCHOR_CHARS) {
    return `Gate B's anchor comes from the last path segment of the URL, and this one normalizes to ${JSON.stringify(normalized)}, under the ${MIN_DERIVED_ANCHOR_CHARS} characters it needs. The anchor is never supplied by the promisor, so a URL with no meaningful final segment cannot be bonded. Bond the page's own address rather than a directory.`;
  }
  return "";
}

/** What gate B will look for, so the form can print it beside the URL rather than hide it. */
export function derivedAnchorOf(rawUrl: string): string {
  return deriveAnchor(rawUrl.trim());
}

/**
 * Measured untrimmed, because the contract measures untrimmed.
 *
 * `Holdfast.py:2112` takes `str(commitment or "")` and bounds its length before anything strips
 * it. Trimming here would put a pasted sentence carrying a trailing newline through the form at
 * 400 characters and into a refusal at 401.
 */
export function checkCommitment(raw: string, limits: ResolvedLimits = resolveLimits()): string {
  if (!raw.trim()) return "A commitment is required, quoted from the page as it is written there.";
  if (raw.length < limits.commitmentMin) {
    return `A commitment is at least ${limits.commitmentMin} characters. This one is ${raw.length}. A fragment too short to stand alone cannot be found in a document.`;
  }
  if (raw.length > limits.commitmentMax) {
    return `A commitment is at most ${limits.commitmentMax} characters. This one is ${raw.length}, counting the whitespace at either end, which the contract counts too. Quote the sentence, not the section.`;
  }
  const normalized = normalizeText(raw);
  if (normalized.length < MIN_COMMITMENT_NORM_CHARS) {
    return `After normalization this commitment is ${normalized.length} characters, under the ${MIN_COMMITMENT_NORM_CHARS} a model needs to locate a sentence in a document. Normalization keeps letters, digits and single spaces and drops everything else.`;
  }
  return "";
}

/** The form's newline separated field, as the list the contract will parse out of the JSON array. */
export function anchorEntries(raw: string): string[] {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** What is sent as the `anchor_words` argument: a JSON array string, never a bare list. */
export function anchorWordsJson(raw: string): string {
  return JSON.stringify(anchorEntries(raw));
}

/**
 * Gate C's section list, one entry per line.
 *
 * One line per entry rather than one word, because the contract allows 64 characters per entry
 * and the sections worth naming in a terms page are phrases: "customer content", "limitation of
 * liability". Splitting on whitespace made those two entries each and quietly changed what gate C
 * was asked to find.
 *
 * Duplicates are refused after normalization, which is what the contract compares, so "Customer
 * Content" and "customer content" collide here exactly as they collide there.
 */
export function checkAnchorEntries(raw: string, limits: ResolvedLimits = resolveLimits()): string {
  const entries = anchorEntries(raw);
  if (entries.length === 0) {
    return "At least one section marker is required. Gate C looks for them to confirm the retrieved artefact is structurally the document.";
  }
  if (entries.length < limits.anchorWordsMin) {
    return `Gate C needs at least ${limits.anchorWordsMin} section markers, one per line. This has ${entries.length}.`;
  }
  if (entries.length > limits.anchorWordsMax) {
    return `Gate C takes at most ${limits.anchorWordsMax} section markers. This has ${entries.length}. A gate that fails on healthy pages turns every check into a blank frame.`;
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeText(entry);
    if (normalized.length < limits.anchorWordMin || normalized.length > limits.anchorWordMax) {
      return `Every section marker normalizes to between ${limits.anchorWordMin} and ${limits.anchorWordMax} characters. ${JSON.stringify(entry.slice(0, 40))} normalizes to ${normalized.length}.`;
    }
    if (seen.has(normalized)) {
      return `${JSON.stringify(entry.slice(0, 40))} is a duplicate of another line once normalized. Gate C counts distinct sections, so a repeat would raise the count without raising the evidence.`;
    }
    seen.add(normalized);
  }
  return "";
}

/**
 * Gate D's terminal marker.
 *
 * It has to be something that appears at the end of the document and nowhere in the page
 * chrome, because gate D exists to catch a truncated capture and it can only do that if its
 * input is independent of gate B's and gate C's. The measured chrome-only shell is what proves
 * the point: it carried the page title, so gate B passed on it, and gate D is what noticed the
 * document was not there.
 */
export function checkTerminal(raw: string, limits: ResolvedLimits = resolveLimits()): string {
  const value = raw.trim();
  if (!value) {
    return "A terminal marker is required. Gate D uses it to tell a whole document from a truncated one.";
  }
  if (value.length < limits.anchorWordMin) {
    return `A terminal marker is at least ${limits.anchorWordMin} characters.`;
  }
  if (value.length > MAX_TERMINAL_CHARS) {
    return `A terminal marker of more than ${MAX_TERMINAL_CHARS} characters is too brittle to match.`;
  }
  return "";
}

/**
 * Gate D's independence rule, which is the one nobody guesses.
 *
 * `Holdfast.py:1210` refuses a terminal marker that overlaps gate B's anchor or any of gate C's
 * sections, by equality or by substring, in both directions. It is checked inside
 * `GateSpec.validate()`, which `create_bond` calls after the stake has been attached, so a marker
 * that reads as perfectly sensible costs a signature and a refund rather than a bond.
 *
 * The rule exists because the declared markers for two of the four measured pages were degenerate:
 * one page's terminal marker was the same string as its anchor, another's was one of its own
 * section words. On those pages gate D could not fail unless B or C had already failed, so the
 * composite was three gates wearing four names. The form has to be able to say that before a
 * wallet opens, and it has to say which field it collided with, because the anchor is derived and
 * the promisor cannot see it anywhere else.
 */
export function checkTerminalIndependence(
  rawTerminal: string,
  rawUrl: string,
  rawEntries: string,
): string {
  const terminal = normalizeText(rawTerminal);
  if (!terminal) return "";
  const anchor = normalizeText(deriveAnchor(rawUrl.trim()));
  if (anchor && (terminal.includes(anchor) || anchor.includes(terminal))) {
    return `Gate D's marker has to be independent of gate B's anchor, and this one overlaps it: the anchor derived from the URL is ${JSON.stringify(anchor)}. A marker that cannot fail on its own is not a fourth gate, it is the second one under another name. Use a phrase from the end of the document instead.`;
  }
  for (const entry of anchorEntries(rawEntries)) {
    const section = normalizeText(entry);
    if (!section) continue;
    if (terminal.includes(section) || section.includes(terminal)) {
      return `Gate D's marker has to be independent of every gate C section, and this one overlaps ${JSON.stringify(entry.slice(0, 40))}. Gate D exists to catch a capture that stops early, which it can only do if it is asked about something the other gates are not.`;
    }
  }
  return "";
}

export function checkTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "A baseline capture timestamp is required.";
  if (!isArchiveTimestamp(value)) {
    return "A capture timestamp is exactly 14 digits, as in 20260822123203. Anything looser resolves to a redirect and is refused.";
  }
  return "";
}

export function checkPayee(raw: string, promisor?: string): string {
  const value = raw.trim();
  if (!value) return "A payee is required. It is who receives the stake if the commitment weakens.";
  if (!ADDRESS.test(value)) return "That is not a 20 byte address.";
  if (value.toLowerCase() === ZERO_ADDRESS) {
    return "The zero address cannot be the payee. A stake payable there is burned rather than owed to anyone.";
  }
  if (promisor && value.toLowerCase() === promisor.trim().toLowerCase()) {
    return "The payee cannot be the promisor. A bond payable to its own poster is not a promise to anyone.";
  }
  return "";
}

export function checkStake(raw: string): string {
  const value = raw.trim();
  if (!value) return "A stake is required. It is what the commitment is worth to the promisor.";
  let wei: bigint;
  try {
    wei = genToWei(value);
  } catch (error) {
    return error instanceof Error ? error.message : "That is not an amount of GEN.";
  }
  if (wei <= 0n) return "A stake of zero would make the bond decorative.";
  return "";
}

export function checkTermDays(raw: string, limits: ResolvedLimits = resolveLimits()): string {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return "A term is a whole number of days.";
  const days = Number(value);
  if (days < limits.termDaysMin) return `The shortest term is ${limits.termDaysMin} days.`;
  if (days > limits.termDaysMax) {
    return `The longest term is ${limits.termDaysMax} days.`;
  }
  return "";
}

export function validateDraft(
  draft: BondDraft,
  promisor?: string,
  limits: ResolvedLimits = resolveLimits(),
): FieldError[] {
  const checks: Array<[string, string]> = [
    ["bondId", checkBondId(draft.bondId)],
    ["url", checkUrl(draft.url) || checkDerivedAnchor(draft.url)],
    ["commitment", checkCommitment(draft.commitment, limits)],
    ["anchorEntries", checkAnchorEntries(draft.anchorEntries, limits)],
    ["anchorTerminal",
      checkTerminal(draft.anchorTerminal, limits) ||
        checkTerminalIndependence(draft.anchorTerminal, draft.url, draft.anchorEntries)],
    ["baselineTimestamp", checkTimestamp(draft.baselineTimestamp)],
    ["payee", checkPayee(draft.payee, promisor)],
    ["stake", checkStake(draft.stake)],
    ["termDays", checkTermDays(draft.termDays, limits)],
  ];
  return checks
    .filter(([, message]) => message !== "")
    .map(([field, message]) => ({ field, message }));
}

/**
 * What this form cannot tell the promisor, whatever it says about the draft.
 *
 * A clean draft is not a call that will succeed. Four refusals are out of reach here and they are
 * out of reach for two different reasons, which the create page keeps apart.
 *
 * The first three live past the first network call: the archive may hold fewer than the minimum
 * change points for this URL, the baseline capture may fail the gates, and the baseline may read as
 * anything other than HOLDS. Nothing in a browser can answer those.
 *
 * The fourth is different. The id and the url-and-commitment pair are checked deterministically,
 * before the first network call, but against contract state this form does not hold. So a
 * simulation of the call can answer it and this file cannot. That is exactly what the zero-value
 * dry run in `dry-run.ts` is for, and it is why the contract's value check is ordered last.
 */
export const UNCHECKABLE_BEFORE_SIGNING = [
  "whether the archive holds enough change points for this URL to be worth monitoring",
  "whether the baseline capture passes the gates once it is fetched and decoded",
  "whether the baseline capture reads as carrying this commitment at all",
  "whether this id, or this url and commitment pair, is already bonded",
];

/** The contest form takes two fields and holds them to the same standards as creation. */
export function validateContest(url: string, timestamp: string): FieldError[] {
  const errors: FieldError[] = [];
  const urlError = checkUrl(url);
  if (urlError) errors.push({ field: "contestUrl", message: urlError });
  const timestampError = checkTimestamp(timestamp);
  if (timestampError) errors.push({ field: "contestTimestamp", message: timestampError });
  return errors;
}
