/**
 * Turns whatever a wallet, an injected provider, or the GenLayer client throws into a sentence a
 * person can read.
 *
 * None of those are guaranteed to throw a real `Error`. EIP-1193 providers routinely reject with
 * a plain `{ code, message, data }` object, and viem/genlayer-js wrap those again in their own
 * plain objects with `shortMessage`/`cause`/`details`. `error instanceof Error ? error.message :
 * String(error)`, which every write and read path in this file's siblings used before this file
 * existed, treats every one of those as "not an Error" and falls through to `String(...)`, which
 * on a plain object is always the literal text `[object Object]`, a real message discarded for
 * four words that describe nothing. A live simulation run against this exact deployment during
 * this project's evidence pass hit precisely that: the dry run's own catch block rendered
 * "The simulation did not produce a tagged answer... [object Object]" for a thrown value that was
 * never a string in the first place.
 *
 * A rejection code of 4001 (EIP-1193's "user rejected the request") is not a fault in this app or
 * the contract, so it gets its own calm sentence rather than whatever wording the wallet chose.
 */

const MESSAGE_KEYS = ["shortMessage", "message", "reason", "details"] as const;
const NESTED_KEYS = ["cause", "error", "data", "originalError", "innerError"] as const;
const REJECTION_CODES: readonly (string | number)[] = [4001, "4001", "ACTION_REJECTED"];

function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function normalizeError(error: unknown): string {
  if (error === null || error === undefined) return "The request failed with no further detail.";
  if (typeof error === "string") return error.trim() || "The request failed with no further detail.";
  if (typeof error === "number" || typeof error === "boolean") return String(error);

  const code = readField(error, "code");
  if (REJECTION_CODES.includes(code as string | number)) {
    return "Transaction rejected in wallet.";
  }

  // Breadth-first over the error and any nested cause/provider/RPC error objects, collecting
  // every message-shaped field it carries. The outermost object's fields come first, because
  // that is usually the most specific description of what a caller-facing library decided to
  // say; a deeply nested `data.message` is still reached, just later.
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  const candidates: string[] = [];
  while (queue.length > 0 && seen.size < 12) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of MESSAGE_KEYS) {
      const value = readField(current, key);
      if (typeof value === "string" && value.trim()) candidates.push(value.trim());
    }
    for (const key of NESTED_KEYS) {
      const next = readField(current, key);
      if (next && typeof next === "object") queue.push(next);
    }
  }
  if (candidates.length > 0) return candidates[0];

  if (error instanceof Error) return error.message.trim() || error.name || "The request failed.";

  if (typeof code === "number" || typeof code === "string") {
    return `The request failed (code ${code}).`;
  }

  // Last resort: an object with none of the usual shapes. Serialize what it actually holds
  // rather than ever falling through to `String(error)`, which is always "[object Object]".
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return `The request failed: ${json}`;
  } catch {
    // Circular or otherwise non-serializable. Fall through to the fixed sentence below.
  }
  return "The request failed with an error this app could not read.";
}
