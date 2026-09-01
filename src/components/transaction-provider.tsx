"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TransactionHash } from "genlayer-js/types";
import type { StoredTransaction, TxStage } from "@/lib/contract-types";
import { RETRYABLE_STAGES } from "@/lib/contract-types";
import { createReadClient } from "@/lib/genlayer/read-client";
import { readTransactions, writeTransactions } from "@/lib/storage";
import {
  applyTransactionSnapshot,
  normalizeStoredTransactions,
  shouldRefreshTransaction,
  STALE_AFTER_MS,
} from "@/lib/transaction-state";

type TransactionContextValue = {
  transactions: StoredTransaction[];
  clear: () => void;
  track: (tx: StoredTransaction) => void;
  update: (
    hash: StoredTransaction["hash"],
    status: TxStage,
    executionResult?: StoredTransaction["executionResult"],
    executionError?: string,
  ) => void;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<StoredTransaction[]>(() =>
    typeof window === "undefined" ? [] : normalizeStoredTransactions(readTransactions()),
  );

  const persist = useCallback((items: StoredTransaction[]) => {
    setTransactions(items);
    writeTransactions(items);
  }, []);

  const track = useCallback(
    (tx: StoredTransaction) => {
      persist([tx, ...readTransactions().filter((item) => item.hash !== tx.hash)]);
    },
    [persist],
  );

  const update = useCallback(
    (
      hash: StoredTransaction["hash"],
      status: TxStage,
      executionResult?: StoredTransaction["executionResult"],
      executionError?: string,
    ) => {
      persist(
        readTransactions().map((item) =>
          item.hash === hash ? { ...item, status, executionResult, executionError } : item,
        ),
      );
    },
    [persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  // Rows left mid-flight by a closed tab are re-read from the chain rather than left
  // frozen at whatever stage they were in when the tab went away. A row that cannot be
  // re-read and is older than the stale window becomes UNDETERMINED, which is a
  // retryable stage and not a failure. It is never quietly promoted to FINALIZED.
  useEffect(() => {
    const staleMarked = normalizeStoredTransactions(readTransactions());
    writeTransactions(staleMarked);
    const pending = staleMarked.filter((tx) => shouldRefreshTransaction(tx));
    if (pending.length === 0) return;
    const client = createReadClient();
    let cancelled = false;

    async function refresh() {
      const refreshed = await Promise.all(
        pending.map(async (tx) => {
          try {
            const onchain = await client.getTransaction({ hash: tx.hash as TransactionHash });
            return applyTransactionSnapshot(tx, onchain);
          } catch {
            const created = Date.parse(tx.createdAt);
            if (!Number.isNaN(created) && Date.now() - created >= STALE_AFTER_MS) {
              return { ...tx, status: "UNDETERMINED" as TxStage };
            }
            return tx;
          }
        }),
      );
      if (cancelled) return;
      const current = readTransactions();
      const byHash = new Map(refreshed.map((tx) => [tx.hash, tx]));
      persist(current.map((tx) => byHash.get(tx.hash) ?? tx));
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [persist]);

  const value = useMemo(
    () => ({ transactions, clear, track, update }),
    [clear, track, transactions, update],
  );
  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}

export function useTransactions() {
  const value = useContext(TransactionContext);
  if (!value) throw new Error("useTransactions must be used inside TransactionProvider");
  return value;
}

export function isRetryableStage(status: TxStage) {
  return RETRYABLE_STAGES.has(status);
}
