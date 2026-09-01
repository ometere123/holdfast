"use client";

/**
 * Every stage a write passes through, drawn as a strip of bars.
 *
 * All six consensus stages are always present, so the rail shows how far along a write is
 * rather than only naming where it stopped. PENDING, PROPOSING, COMMITTING, REVEALING,
 * ACCEPTED and FINALIZED each get a bar whether or not this transaction has reached it.
 *
 * The three retryable stages are the reason this component is not just a status word.
 * UNDETERMINED, VALIDATORS_TIMEOUT and LEADER_TIMEOUT are consensus failing to conclude, not
 * consensus concluding against the caller. They get the dashed hatching the blank frame uses,
 * the tag [TRANSIENT], and a sentence saying so, because a person looking at a rail that
 * stopped needs to know whether to press the button again or to stop pressing it.
 */

import type { StoredTransaction, TxStage } from "@/lib/contract-types";
import { CONSENSUS_STAGES, RETRYABLE_STAGES } from "@/lib/contract-types";
import { explorerTxUrl } from "@/lib/genlayer/config";
import { displayTime, shortenHex } from "@/lib/format";
import { useTransactions } from "./transaction-provider";

/** Where a stage sits on the six bar rail, or -1 for a stage that is not on it. */
function stagePosition(status: TxStage): number {
  switch (status) {
    case "UNINITIALIZED":
      return -1;
    case "READY_TO_FINALIZE":
    case "APPEAL_COMMITTING":
    case "APPEAL_REVEALING":
      // An appeal round is a re-run of commit and reveal after acceptance, so the rail shows
      // it as still standing at ACCEPTED rather than inventing a seventh bar.
      return CONSENSUS_STAGES.indexOf("ACCEPTED");
    default: {
      const at = CONSENSUS_STAGES.indexOf(status as (typeof CONSENSUS_STAGES)[number]);
      return at;
    }
  }
}

const STAGE_NOTE: Partial<Record<TxStage, string>> = {
  READY_TO_FINALIZE: "Accepted and waiting to finalize.",
  APPEAL_COMMITTING: "An appeal round is committing. The write is still live.",
  APPEAL_REVEALING: "An appeal round is revealing. The write is still live.",
  CANCELED: "Canceled before consensus ran. Nothing was recorded.",
};

export function StageRail({
  status,
  executionResult,
}: {
  status: TxStage;
  executionResult?: StoredTransaction["executionResult"];
}) {
  const retryable = RETRYABLE_STAGES.has(status);
  const reverted = executionResult === "ROLLBACK" || executionResult === "ERROR";
  const reached = stagePosition(status);

  return (
    <div>
      <ul className="flex list-none gap-1 p-0" aria-hidden="true">
        {CONSENSUS_STAGES.map((stage, index) => {
          const done = reached >= index;
          const now = reached === index && status !== "FINALIZED";
          const state = retryable
            ? "hf-stage-retry"
            : now
              ? "hf-stage-now"
              : done
                ? "hf-stage-done"
                : "";
          return (
            <li key={stage} className={`flex-1 ${state}`}>
              <div className={`hf-stage-bar ${now ? "hf-stage-active" : ""}`} />
            </li>
          );
        })}
      </ul>
      <ul className="mt-1 flex list-none gap-1 p-0">
        {CONSENSUS_STAGES.map((stage, index) => (
          <li
            key={stage}
            className={`hf-record-sm flex-1 ${reached >= index && !retryable ? "hf-label-ink" : ""}`}
            style={{ color: reached >= index && !retryable ? "var(--emulsion)" : "var(--emulsion-72)" }}
          >
            {stage.toLowerCase()}
          </li>
        ))}
      </ul>

      {retryable ? (
        <p className="hf-note mt-2">
          <span className="hf-record hf-tag hf-tag-open">[TRANSIENT]</span>{" "}
          {status.toLowerCase().replace(/_/g, " ")}. This is a retryable consensus state, not a
          failure and not a rejection. Nothing was recorded and no stake moved. Sending the same
          call again is the expected next step.
        </p>
      ) : reverted ? (
        <p className="hf-note mt-2">
          <span className="hf-record hf-tag hf-tag-verdict">[REVERTED]</span> Consensus concluded
          and the call was refused. This is a verdict, so sending it again unchanged will reach the
          same one.
        </p>
      ) : STAGE_NOTE[status] ? (
        <p className="hf-note mt-2">{STAGE_NOTE[status]}</p>
      ) : null}
    </div>
  );
}

export function TransactionRail() {
  const { transactions, clear } = useTransactions();

  if (transactions.length === 0) {
    return (
      <div>
        <h2 className="hf-heading">Transactions from this browser</h2>
        <p className="hf-note mt-2 max-w-[62ch]">
          Nothing has been sent from this browser yet. This list is a local record of what you sent,
          not a record of the bond. The bond keeps its own record on chain and every page here reads
          that one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="hf-heading">Transactions from this browser</h2>
        <button type="button" className="hf-btn-quiet" onClick={clear}>
          Clear this list
        </button>
      </div>
      <p className="hf-note mt-2 max-w-[62ch]">
        A local record of what this browser sent. Clearing it removes nothing from the chain.
      </p>
      <ul className="mt-4 list-none p-0">
        {transactions.map((tx) => (
          <li key={tx.hash} className="hf-rule py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="hf-body">{tx.label}</span>
              <span className="hf-record-sm">{displayTime(tx.createdAt)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <a
                className="hf-record underline"
                href={explorerTxUrl(tx.hash)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {shortenHex(tx.hash, 10, 8)}
              </a>
              {tx.bondId ? <span className="hf-record-sm">bond {tx.bondId}</span> : null}
              {tx.functionName ? <span className="hf-record-sm">{tx.functionName}</span> : null}
            </div>
            <div className="mt-3">
              <StageRail status={tx.status} executionResult={tx.executionResult} />
            </div>
            {tx.executionError ? (
              <p className="hf-record-sm mt-2 max-w-[72ch]">{tx.executionError}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
