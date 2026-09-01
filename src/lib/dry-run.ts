/**
 * Simulating `create_bond` with no value attached, before any value is sent.
 *
 * The trick is that the contract's own value check is deliberately the LAST deterministic check
 * (`Holdfast.py:2593`). So a call with zero value runs every other deterministic refusal first and
 * can only stop at the value check. Reaching that specific refusal is therefore a positive result:
 * it means nothing else objected.
 *
 * This used to be the thing standing between a typo and a lost stake. `create_bond` refused by
 * reverting, and a GenVM revert undoes the storage writes without undoing the transfer that funded
 * the call, so a refusal past the first network call kept the stake. That was measured on chain and
 * the contract was changed: `create_bond` is now a refusal boundary that refunds and returns the
 * tagged sentence instead of raising it (`Holdfast.py:2506`). The stake is no longer at risk here,
 * so what this module is for is narrower than it was and still worth having. The id and the
 * url-and-commitment pair are checked deterministically against contract state that no browser
 * holds, which makes this the only place a promisor can learn about a collision without signing.
 *
 * THE REFUND BOUNDARY CHANGED WHAT AN ANSWER LOOKS LIKE, AND THAT IS WHY `returnedMessage` EXISTS.
 * A refusal that is returned rather than raised arrives here as a return value, so the stake refusal
 * on a clean draft does not throw at all. An earlier version of this module read only the thrown
 * form and treated every normal return as INCONCLUSIVE, which would have graded every clean draft
 * as unanswerable the moment the contract stopped reverting. Both deliveries are read now, and the
 * tag is what decides, never whether the call came back or threw.
 *
 * There is no simulate helper in `src/lib/genlayer/`, which is a proven client layer that is not
 * edited here. This is built on `readContract` against a write method, which is a thing a node may
 * legitimately refuse to do. That refusal has its own outcome and is reported as itself. A
 * simulation that did not run must never be drawn as a simulation that passed.
 */

import type { CalldataEncodable } from "genlayer-js/types";
import { CONTRACT_ADDRESS, IS_LIVE } from "./genlayer/config.ts";
import { createReadClient } from "./genlayer/read-client.ts";
import { findRefusal, reasonAfterTag } from "./revert-tags.ts";

/** The refusal that means every other deterministic check passed. Matched, not guessed. */
export const STAKE_REFUSAL = "a bond needs a stake; this call carried no value";

const EXPECTED_TAG = "[EXPECTED]";
const OTHER_TAGS = ["[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"];

/**
 * The five honest answers a dry run can give.
 *
 * `PASSED` is bounded on purpose and its `caveat` says how: it covers the checks the contract can
 * answer without the network, and the archive checks that follow are not among them.
 */
export type DryRun =
  | { kind: "PASSED"; caveat: string }
  | { kind: "REFUSED"; reason: string }
  | { kind: "UNSUPPORTED"; detail: string }
  | { kind: "INCONCLUSIVE"; detail: string }
  | { kind: "SKIPPED"; detail: string };

/**
 * A node saying "I will not execute a write method as a read".
 *
 * Deliberately broad, and it is checked after the tagged cases rather than before, because a
 * tagged message is the contract speaking and takes precedence over a transport guess.
 */
function looksUnsupported(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("not a view") ||
    text.includes("non-view") ||
    text.includes("read-only") ||
    text.includes("readonly") ||
    text.includes("unsupported method") ||
    text.includes("method not supported") ||
    text.includes("does not support") ||
    text.includes("not callable") ||
    text.includes("write method") ||
    text.includes("nondeterministic block") ||
    text.includes("method not found")
  );
}

/**
 * The refusal a simulation produced, whichever way the contract delivered it.
 *
 * `create_bond` is a refusal boundary, so it returns its refusal sentence rather than raising it,
 * and `readContract` hands back the decoded `str`. A returned string only counts as an answer if it
 * carries one of the four tags: an untagged return is a value this contract cannot have produced
 * under zero value, and guessing at it is how a simulation that answered nothing gets drawn as a
 * pass. `findRefusal` is used rather than a leading-tag test because a refusal that crossed a
 * consensus boundary arrives wrapped as `Refusal([TAG] reason)` with the tag at index 8.
 */
function returnedMessage(returned: unknown): string | undefined {
  if (typeof returned !== "string") return undefined;
  return findRefusal(returned) ? returned : undefined;
}

/**
 * Sorts one simulation attempt into an outcome. Pure, so the tests can exercise every branch
 * without a node.
 *
 * `thrown` is the message a raising call produced. `returned` is set instead when the call came back
 * normally, which is the ordinary case for this contract: `create_bond` refuses by returning. So a
 * return carrying a tag is read exactly as a throw carrying the same tag would be.
 *
 * A return carrying NO tag is still INCONCLUSIVE and never a pass. Under zero value the contract's
 * value check has to fire, so an untagged return means the deterministic body did not run. Treating
 * it as a pass is the one mistake here that would put a draft in front of a wallet on no evidence.
 */
export function classifyDryRun(attempt: { thrown?: string; returned?: unknown }): DryRun {
  const message = attempt.thrown ?? returnedMessage(attempt.returned);

  if (message === undefined) {
    return {
      kind: "INCONCLUSIVE",
      detail:
        "The simulation came back without a tagged refusal. With no stake attached the contract's value check has to refuse, and it refuses by returning a tagged sentence, so an answer with no tag in it means the deterministic body did not run and this simulation answered nothing.",
    };
  }

  if (message.includes(STAKE_REFUSAL)) {
    return {
      kind: "PASSED",
      caveat:
        "The contract stopped at its value check, which is the last thing it checks before it touches the network. Every check above it passed. The archive checks that come after it have not run and cannot run without the stake: whether the Internet Archive holds enough captures of this URL, and whether the baseline capture qualifies, are still open questions.",
    };
  }

  if (message.includes(EXPECTED_TAG)) {
    return { kind: "REFUSED", reason: reasonAfterTag(message, EXPECTED_TAG) };
  }

  const other = OTHER_TAGS.find((tag) => message.includes(tag));
  if (other) {
    return {
      kind: "INCONCLUSIVE",
      detail: `The simulation came back tagged ${other}, which is the archive or the consensus round speaking and not a judgement about this draft: ${reasonAfterTag(message, other)}`,
    };
  }

  if (looksUnsupported(message)) {
    return {
      kind: "UNSUPPORTED",
      detail: `This node would not simulate a write method, so the simulation was not available and only the local checks above ran: ${message}`,
    };
  }

  return {
    kind: "INCONCLUSIVE",
    detail: `The simulation did not produce a tagged answer, so nothing can be concluded from it either way: ${message}`,
  };
}

/**
 * Calls `create_bond` as a read, with no value.
 *
 * `client` is optional and the difference matters enough to state on the page. Passing the wallet's
 * own client makes `gl.message.sender_address` the address that would really sign, which is the
 * only way the contract's "payee must not be the promisor" rule can be exercised here. With the
 * fallback read client the sender is an ephemeral throwaway address, so that one rule is answered
 * locally instead and the caller is told so.
 */
export async function dryRunCreateBond(
  args: CalldataEncodable[],
  client?: { readContract: (options: { address: `0x${string}`; functionName: string; args: never[] }) => Promise<unknown> },
): Promise<DryRun> {
  if (!IS_LIVE || !CONTRACT_ADDRESS) {
    return {
      kind: "SKIPPED",
      detail:
        "No contract is configured in this build, so there was nothing to simulate against. The local checks above ran for real; the contract's own checks did not run at all.",
    };
  }

  const caller = client ?? createReadClient();
  try {
    const returned = await caller.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "create_bond",
      args: args as never[],
    });
    return classifyDryRun({ returned });
  } catch (error) {
    return classifyDryRun({ thrown: error instanceof Error ? error.message : String(error) });
  }
}
