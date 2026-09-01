/**
 * What a write actually returned, read off the leader receipt.
 *
 * This exists because of one uncomfortable fact about GenLayer, and it was measured on
 * chain rather than reasoned about. Transaction 0xc3a12dd2 sent 250,000,000,000,000,000
 * wei into `create_bond`, reached a refusal one network call in, and resolved as a
 * rollback. A GenVM revert undoes the storage writes; it does NOT undo the transfer that
 * funded the call. The stake stayed in the contract, escrowed against a bond that was
 * never created, with no method that could pay it out.
 *
 * So both payable methods, `create_bond` and `contest_breach`, are now refusal
 * boundaries: they catch `gl.vm.UserError`, emit the refund, and RETURN the refusal's
 * tagged sentence instead of raising it. The cost of that choice is that "the transaction
 * succeeded" and "the request was accepted" stop being the same statement. A transaction
 * that refunds and returns `[EXTERNAL] ...` finalizes with GenVM SUCCESS, and a UI that
 * only checks the first fact would tell someone their page was bonded when the contract
 * had just handed their stake back.
 *
 * THE TAG VOCABULARY IS NOT RESTATED HERE. `findRefusal` reads it out of `OUTCOMES`, so
 * this decoder recognises exactly the four tags the rest of the app renders copy for, in
 * both message shapes: the sentence the contract writes itself, tag first, and the repr of
 * a `Refusal` that crossed `strict_eq`, tag eight characters in. `_refund_and_report`
 * returns whichever it was handed, verbatim, so both shapes arrive here.
 *
 * StudioNet's `leader_receipt[0].result` is a base64 payload whose first byte is a
 * result code: 0 return, 1 rollback, 2 contract error. genlayer-js decodes it into
 * `{status, payload}` before the app ever sees it. Both shapes are handled here, the
 * decoded object and the raw base64 string, so this works whether the caller went through
 * the client or read the RPC directly.
 */

import { findRefusal, type TaggedRefusal } from "../revert-tags.ts";

export type ReturnedValue =
  /** The call returned. `text` is the returned value rendered as text. */
  | { kind: "returned"; text: string }
  /** The call rolled back or errored. `message` is the contract's own words. */
  | { kind: "reverted"; message: string }
  /** No receipt, or a payload in a shape this decoder does not recognise. */
  | { kind: "unreadable" };

/** Decodes one leader receipt's `result` field, in either shape. */
export function returnedValue(result: unknown): ReturnedValue {
  if (typeof result === "string") return fromBase64(result);
  if (!isRecord(result)) return { kind: "unreadable" };

  const status = result.status;
  const payload = result.payload;

  if (status === "rollback" || status === "contract_error" || status === "error") {
    return { kind: "reverted", message: typeof payload === "string" ? payload : "" };
  }
  if (status === "return") {
    if (payload === null || payload === undefined) return { kind: "returned", text: "" };
    if (typeof payload === "string") return { kind: "returned", text: payload };
    if (isRecord(payload) && typeof payload.readable === "string") {
      return { kind: "returned", text: unquote(payload.readable) };
    }
    return { kind: "unreadable" };
  }
  if (status === "none") return { kind: "returned", text: "" };
  if (typeof result.raw === "string") return fromBase64(result.raw);
  return { kind: "unreadable" };
}

/**
 * The refusal a payable call RETURNED, or null if it did not refuse.
 *
 * Only a returned value counts. A revert carrying the same words is a different event with
 * different consequences for the caller's GEN, and conflating the two would defeat the
 * point of having separated them in the contract. The non-payable methods still raise, and
 * their messages reach the reader down the throw path instead.
 *
 * The whole `TaggedRefusal` is handed back rather than just the reason text, because the
 * tag is the part that decides what the reader is told to do next. `create_bond` returns
 * all four tags: `[EXPECTED]` for a draft it will never accept, `[EXTERNAL]` for an
 * archive that answered unusably, `[TRANSIENT]` for a replay that disagreed with its own
 * index, and `[LLM_ERROR]` for a reading that failed closed. Only the first is a verdict.
 * A caller that flattened these to one class would tell someone whose page the archive
 * happens not to have captured yet that their draft was wrong.
 */
export function returnedRefusal(value: ReturnedValue): TaggedRefusal | null {
  if (value.kind !== "returned") return null;
  return findRefusal(value.text.trim());
}

/** Convenience for the common case: decode a receipt result and test it. */
export function refusalIn(result: unknown): TaggedRefusal | null {
  return returnedRefusal(returnedValue(result));
}

/** The leader receipt's `result`, decoded, however deeply the client wrapped it. */
export function returnedFromTransaction(transaction: unknown): ReturnedValue {
  if (!isRecord(transaction)) return { kind: "unreadable" };
  const consensus = transaction.consensus_data;
  if (!isRecord(consensus)) return { kind: "unreadable" };
  const leader = consensus.leader_receipt;
  const first = Array.isArray(leader) ? leader[0] : leader;
  return returnedValue(isRecord(first) ? first.result : undefined);
}

/**
 * The undecoded form. First byte is the result code; for a return the remainder is
 * calldata-encoded, which is not worth reimplementing here, so the bytes are read as text
 * and the tag is looked for inside them. A calldata string is length-prefixed, so the tag
 * does not sit at byte zero and a search is the honest test rather than a prefix check.
 *
 * The text is sliced from the tag onward when one is found, which drops the length prefix
 * and any framing bytes ahead of it. When none is found the body is passed through whole:
 * a successful `create_bond` returns a receipt sentence carrying the url, the stake and the
 * timestamps, and truncating that would lose the only record of what was escrowed.
 */
function fromBase64(encoded: string): ReturnedValue {
  let bytes: Uint8Array;
  try {
    const binary = atob(encoded);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return { kind: "unreadable" };
  }
  if (bytes.length === 0) return { kind: "unreadable" };
  const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(1));
  if (bytes[0] === 1 || bytes[0] === 2 || bytes[0] === 3) {
    return { kind: "reverted", message: body };
  }
  if (bytes[0] === 0) {
    const tagged = findRefusal(body);
    if (!tagged) return { kind: "returned", text: body };
    const at = body.indexOf(tagged.tag);
    return { kind: "returned", text: body.slice(at) };
  }
  if (bytes[0] === 4) return { kind: "returned", text: "" };
  return { kind: "unreadable" };
}

/** `"\"d2\""` is how a returned string arrives once decoded. */
function unquote(readable: string): string {
  const trimmed = readable.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed.replace(/^"|"$/g, "");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
