"use client";

/**
 * One write, from a click to a receipt, with the phase always nameable.
 *
 * The refusal classes are kept apart deliberately. `[EXPECTED]` is the contract or this browser
 * declining on stated terms, `[EXTERNAL]` is the archive being unreadable, `[TRANSIENT]` is
 * consensus not concluding, and `[LLM_ERROR]` is a reading that failed closed. Only the first is
 * a verdict. Collapsing them into one error state would put an unreachable archive and a refused
 * request in the same box, and the entire point of this product is that those are different.
 */

import { useCallback, useState } from "react";
import type { CalldataEncodable, TransactionHash } from "genlayer-js/types";
import { IS_LIVE } from "@/lib/genlayer/config";
import { returnedRefusal } from "@/lib/genlayer/returned-value";
import { waitAccepted, writeContract } from "@/lib/genlayer/tx";
import type { WritePhase } from "@/lib/contract-types";
import type { OutcomeClass } from "@/lib/lifecycle";
import { findRefusal } from "@/lib/revert-tags";
import { normalizeError } from "@/lib/wallet-errors";
import { useTransactions } from "./transaction-provider";
import { useWallet } from "./wallet-provider";

export type WriteState = {
  phase: WritePhase;
  hash?: TransactionHash;
  /** Set only when the round did not produce a verdict about the commitment. */
  outcome?: OutcomeClass;
  /** The exact message, kept verbatim. Never replaced with "something went wrong". */
  message?: string;
};

const IDLE: WriteState = { phase: "idle" };

/**
 * Sorts a thrown message into the four non-finding outcome classes.
 *
 * THE TAG DECIDES, AND IT DID NOT USED TO. This function previously matched lowercase English words
 * and never looked at the tags the contract puts on every single revert. It got the `cdx-*` refusals
 * right by accident, because their reason text contains "cdx", and got
 * `Refusal([TRANSIENT] digest-mismatch: want ... got ... over 215912 raw bytes)` wrong: nothing
 * matched, so it fell through to `expected`, whose copy tells the reader the contract declined on its
 * own terms and whose `retry` is false. A digest mismatch means two validators fetched different
 * bytes, and running it again is the correct next step. `tests/direct/test_retrieval.py` produced
 * that exact string through the SDK, which is how the defect surfaced.
 *
 * So `findRefusal` runs first and is authoritative. The word lists below only ever see an UNTAGGED
 * message, which means the wallet, the node or the network rather than the contract, and they have
 * been cut back to what can really arrive that way. Anything matching "archive" or "excerpt" is the
 * contract speaking and now never reaches them.
 *
 * The residue defaults to `expected`, the one class that does not invite a retry. That is a choice
 * about an error nobody classified: the verbatim message is always displayed beneath the headline, so
 * a reader is never left with only the guess, and inviting a retry on an unrecognised failure is the
 * worse of the two mistakes.
 */
function classify(message: string): OutcomeClass {
  const tagged = findRefusal(message);
  if (tagged) {
    return tagged.outcome;
  }

  const text = message.toLowerCase();
  if (
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("request rejected") ||
    text.includes("4001")
  ) {
    return "expected";
  }
  // Word-bounded, because these messages usually carry a transaction hash and a bare "429" would
  // match three hex characters inside one.
  if (
    text.includes("fetch failed") ||
    text.includes("rate limit") ||
    text.includes("unreachable") ||
    text.includes("network error") ||
    /\b(403|429|502|503|504)\b/.test(text)
  ) {
    return "external";
  }
  if (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("did not agree") ||
    text.includes("undetermined") ||
    text.includes("rotation")
  ) {
    return "transient";
  }
  return "expected";
}

/**
 * Wallet errors pass through verbatim, with one addition: a wallet that does not implement the
 * GenLayer RPC methods is the wallet's limitation and not a mistake by the person clicking, and
 * saying so is the difference between a dead end and a next step.
 */
function writeErrorMessage(error: unknown) {
  const message = normalizeError(error);
  if (message.includes("does not support") || message.includes("Unsupported method")) {
    const stated = message.replace(/[\s.]+$/, "");
    return `${stated}. Some injected wallets do not implement the GenLayer RPC methods. A wallet that speaks them is required to sign this call.`;
  }
  return message;
}

export function useWriteRunner() {
  const wallet = useWallet();
  const { track, update } = useTransactions();
  const [state, setState] = useState<WriteState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const run = useCallback(
    async (options: {
      label: string;
      functionName: string;
      args: CalldataEncodable[];
      value?: bigint;
      bondId?: string;
      /** Runs entirely in this browser. Returns a plain refusal sentence, or null. */
      preflight?: () => string | null;
    }) => {
      setState({ phase: "validating" });
      const refusal = options.preflight?.() ?? null;
      if (refusal) {
        setState({ phase: "idle", outcome: "expected", message: refusal });
        return { ok: false as const };
      }

      // Fixture mode refuses rather than simulating. A fake receipt would teach the reader
      // that this interface can tell them something it cannot, which is precisely the habit
      // this product exists to break.
      if (!IS_LIVE) {
        setState({
          phase: "idle",
          outcome: "expected",
          message:
            "No Holdfast contract is configured, so this write was refused here rather than pretended. Set NEXT_PUBLIC_HOLDFAST_CONTRACT and NEXT_PUBLIC_HOLDFAST_DATA=live to send it. The validation above ran for real.",
        });
        return { ok: false as const };
      }

      try {
        setState({ phase: "wallet-pending" });
        const client = await wallet.getWriteClient();
        const hash = await writeContract(
          client,
          options.functionName,
          options.args,
          options.value ?? 0n,
        );
        setState({ phase: "submitted", hash });
        track({
          hash,
          label: options.label,
          createdAt: new Date().toISOString(),
          status: "PENDING",
          functionName: options.functionName,
          bondId: options.bondId,
        });
        setState({ phase: "consensus-running", hash });
        const outcome = await waitAccepted(client, hash);
        update(hash, "FINALIZED", outcome.executionResult, outcome.executionError);

        // A payable call that refuses returns the value and finalizes with GenVM SUCCESS
        // rather than raising, because raising after value has arrived strands it: that was
        // measured on chain in transaction 0xc3a12dd2, which kept 250,000,000,000,000,000 wei
        // against a bond it had just declined to create. So the transaction succeeding and the
        // request being accepted are two different facts, and the rail keeps saying FINALIZED
        // while this reports the refusal.
        //
        // The tag decides the outcome class here for the same reason it decides it in
        // `classify` below. A returned refusal is not always the contract declining on its own
        // terms: `create_bond` returns `[EXTERNAL]` when the archive answered unusably and
        // `[TRANSIENT]` when a replay disagreed with its own index, and both of those are worth
        // retrying tomorrow. Reading the tag off the returned string is what keeps the copy and
        // the retry advice the same whether a refusal arrived by return or by throw.
        const refusal = returnedRefusal(outcome.returned);
        if (refusal) {
          setState({
            phase: "idle",
            hash,
            outcome: refusal.outcome,
            message: `The contract refused this request and returned the value you sent: ${refusal.reason}`,
          });
          return { ok: false as const, hash };
        }

        setState({ phase: "settled", hash });
        return { ok: true as const, hash };
      } catch (error) {
        const message = writeErrorMessage(error);
        setState((previous) => ({
          phase: "idle",
          hash: previous.hash,
          outcome: classify(message),
          message,
        }));
        return { ok: false as const };
      }
    },
    [track, update, wallet],
  );

  return {
    state,
    run,
    reset,
    /**
     * The lead sentence when a write cannot be signed at all. "Connect a wallet first" is only
     * useful advice when there is a wallet to connect, so a browser with no extension is told
     * that instead, and a wallet on another chain is told which chain it is on rather than being
     * allowed to sign into the void. Null once a session is open and on this build's network.
     */
    walletGate:
      wallet.mode === "none"
        ? wallet.hasInjected
          ? "Connect a wallet first."
          : "No wallet extension was detected in this browser, so there is nothing to sign with."
        : (wallet.writeBlockedReason ?? null),
  };
}
