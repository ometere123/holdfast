export type ExecutionOutcome = "SUCCESS" | "ROLLBACK" | "ERROR" | "UNKNOWN";

type TransactionLike = {
  consensus_data?: {
    leader_receipt?: Array<{ execution_result?: string; error?: string | null }>;
  };
};

export function inspectGenVMExecution(tx: TransactionLike | null | undefined): {
  executionResult: ExecutionOutcome;
  executionError?: string;
} {
  const leader = tx?.consensus_data?.leader_receipt?.[0];
  const raw = leader?.execution_result;
  const executionResult: ExecutionOutcome =
    raw === "SUCCESS" || raw === "ROLLBACK" || raw === "ERROR" ? raw : "UNKNOWN";
  return { executionResult, executionError: leader?.error ?? undefined };
}

export function assertSuccessfulGenVMExecution(tx: TransactionLike | null | undefined, hash: string) {
  const outcome = inspectGenVMExecution(tx);
  if (outcome.executionResult !== "SUCCESS") {
    // `outcome.executionError` is the leader receipt's own tagged sentence (`[EXTERNAL] the
    // index answered with 1 row(s)...`, `[TRANSIENT] ...`), which is the one piece of this
    // message a reader can act on. Measured live: a rolled-back check_commitment surfaced only
    // "GenLayer contract execution failed (ROLLBACK)" with the reason dropped, which also fed
    // `classify()` a string with no tag in it, so a retryable [EXTERNAL] refusal read as an
    // unretryable "expected" one.
    const reason = outcome.executionError?.trim();
    throw new Error(
      reason
        ? `${reason} (transaction ${hash})`
        : `GenLayer contract execution failed (${outcome.executionResult}). Transaction: ${hash}`,
    );
  }
  return outcome;
}
