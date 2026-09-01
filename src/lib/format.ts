/**
 * Rendering helpers. Nothing here decides anything; every function takes a value the
 * contract produced and returns text.
 *
 * The one rule worth stating: a formatter never invents precision it was not given. A wei
 * amount is divided exactly and printed exactly, timestamps are printed in UTC because the
 * archive indexes them in UTC, and a digest is either printed whole or visibly abbreviated
 * with the full value kept alongside it.
 */

const WEI_PER_GEN = 10n ** 18n;

/** Returns the unit attached, because a bare number in this interface would be ambiguous. */
export function formatGen(wei: string | bigint): string {
  let value: bigint;
  try {
    value = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  } catch {
    return `${String(wei)} wei`;
  }
  const whole = value / WEI_PER_GEN;
  const fraction = value % WEI_PER_GEN;
  if (fraction === 0n) return `${whole.toString()} GEN`;
  const decimals = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}.${decimals} GEN`;
}

export function genToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) {
    throw new Error("A stake is a decimal number of GEN with at most 18 decimal places.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * WEI_PER_GEN + BigInt(fraction.padEnd(18, "0") || "0");
}

/** A percentage of a wei amount, exact integer arithmetic. Used for the contest bond. */
export function percentOfWei(wei: string, percent: number): string {
  try {
    return ((BigInt(wei || "0") * BigInt(Math.round(percent))) / 100n).toString();
  } catch {
    return "0";
  }
}

export function formatCount(value: string | number): string {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) return text || "0";
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatBytes(value: string | number): string {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) return text || "0 B";
  return `${formatCount(text)} B`;
}

export function shortenHex(value: string, head = 6, tail = 4): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * A CDX digest, abbreviated for a heading.
 *
 * Iosevka sets a full 32 character digest on one line at 13px, so the record rows print
 * digests whole. This is for the places where two digests sit either side of an inequality
 * sign in a heading, and the whole value is always available in the row beneath.
 */
export function shortDigest(digest: string): string {
  if (!digest) return "";
  if (digest.length <= 10) return digest;
  return `${digest.slice(0, 4)}…${digest.slice(-4)}`;
}

/* ------------------------------------------------------------------------- *
 * Archive timestamps
 * ------------------------------------------------------------------------- */

const TIMESTAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function isArchiveTimestamp(value: string): boolean {
  return TIMESTAMP.test(value.trim());
}

/** `20260802141133` becomes `2026-08-02 14:11:33 UTC`. Anything else is returned untouched. */
export function frameMoment(timestamp: string): string {
  const match = TIMESTAMP.exec((timestamp ?? "").trim());
  if (!match) return timestamp || "";
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}

/** `20260802141133` becomes `08-02`, the frame label under the strip. */
export function frameTick(timestamp: string): string {
  const match = TIMESTAMP.exec((timestamp ?? "").trim());
  if (!match) return timestamp || "";
  return `${match[2]}-${match[3]}`;
}

/** `20260802141133` becomes `2026-08-02`. */
export function frameDay(timestamp: string): string {
  const match = TIMESTAMP.exec((timestamp ?? "").trim());
  if (!match) return timestamp || "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function timestampToDate(timestamp: string): Date | undefined {
  const match = TIMESTAMP.exec((timestamp ?? "").trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** An ISO instant, printed in UTC. Contract times are stored as ISO strings. */
export function displayTime(iso: string): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function displayDay(iso: string): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Whole days between two ISO instants, floored, signed.
 *
 * Floored rather than rounded because this is used for windows the contract enforces, and
 * rounding up would print a day of contest time that has already gone.
 */
export function daysBetween(fromIso: string, toIso: string): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.floor((to - from) / 86400000);
}

export function hoursBetween(fromIso: string, toIso: string): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.floor((to - from) / 3600000);
}

/* ------------------------------------------------------------------------- *
 * The commitment normalization, mirrored
 * ------------------------------------------------------------------------- */

/**
 * Python's `\s` for `str` patterns, written out, because JavaScript's `\s` is a different set.
 *
 * The two agree on every character anyone types. They disagree on six. Python counts the four
 * file separators U+001C to U+001F and NEL U+0085 as whitespace and JavaScript does not;
 * JavaScript counts the byte order mark U+FEFF and Python does not.
 *
 * That disagreement is not academic, because it changes the output rather than just the
 * classification. A character treated as whitespace collapses to a single space and separates
 * its neighbours. A character treated as ordinary is stripped in step 3 and joins them. So
 * `data` + U+FEFF + `sharing` normalizes to two words under JavaScript's class and to
 * `datasharing` under Python's, and they hash differently. The commitment field accepts any
 * Unicode and 400 characters of it, so a promisor pasting from a document that carries a BOM
 * would be shown a preview of a string the chain never stored, which is the one outcome this
 * function exists to prevent. Hence the explicit class rather than `\s`.
 */
const PYTHON_WHITESPACE_RUN =
  /[ \t\n\r\f\v\x1c\x1d\x1e\x1f\x85\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * The contract's own normalization, mirrored so the form can show what will be hashed.
 *
 * Lowercase, collapse whitespace, strip everything outside `[a-z0-9 ]`, trim. The order is the
 * specification and not an implementation detail, and it is deliberately not idempotent: a
 * stripped character between two spaces leaves both spaces behind, because step 2 has already
 * run and nothing re-collapses them, so `a - b` normalizes to `a  b` with two spaces.
 * `Holdfast.py:1016-1040` pins the same behaviour and records why reordering to collapse last
 * would be a better normalizer and a breaking change to every hash already recorded.
 *
 * Mirrored character for character, whitespace class included. A client that normalized
 * differently would show the promisor a string the chain never stored.
 */
export function normalizeCommitment(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(PYTHON_WHITESPACE_RUN, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

export function pluralFrames(count: number): string {
  return count === 1 ? "1 frame" : `${formatCount(count)} frames`;
}

/**
 * The same function under the contract's other name.
 *
 * `Holdfast.py:1051` defines `normalize_commitment` as `normalize_text` and says so in one line.
 * Both names are exported here for the same reason: a call site normalizing a URL segment should
 * not have to read as though it were normalizing a commitment.
 */
export const normalizeText = normalizeCommitment;

/**
 * Gate B's anchor, derived from the URL exactly as `Holdfast.py:2050` derives it.
 *
 * Four steps: take the last non-empty path segment with the query stripped, drop a trailing file
 * extension of 1 to 5 alphanumeric characters when something is left in front of it, replace
 * hyphens and underscores with spaces, trim. So `/legal/model-terms` yields `model terms` and
 * `/licenses/gpl-3.0.html` yields `gpl 3.0`, and `.html` is dropped while `.0` is not, because
 * the head before it would be empty on the second dot.
 *
 * Mirrored rather than approximated because the create form has to be able to say, before a
 * wallet opens, that a URL ending in a slash or a bare numeral cannot be bonded at all. The
 * contract refuses that case with its reason attached, and a client that guessed here would put
 * the promisor in front of a revert they could not have predicted.
 */
export function deriveAnchor(url: string): string {
  const withoutScheme = (url ?? "").replace(/^https:\/\//, "");
  const slash = withoutScheme.indexOf("/");
  const path = (slash < 0 ? "" : withoutScheme.slice(slash + 1)).split("?")[0];
  const parts = path.split("/");
  let segment = "";
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = parts[i].trim();
    if (candidate !== "") {
      segment = candidate;
      break;
    }
  }
  const dot = segment.lastIndexOf(".");
  if (dot >= 0) {
    const head = segment.slice(0, dot);
    const extension = segment.slice(dot + 1);
    if (head !== "" && extension.length >= 1 && extension.length <= 5 && /^[a-z0-9]+$/i.test(extension)) {
      segment = head;
    }
  }
  return segment.replace(/[-_]/g, " ").trim();
}

