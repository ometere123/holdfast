/**
 * Every write this browser has sent, and where each one stopped.
 *
 * The list lives in this tab's own storage rather than on the contract, and the page says so. A
 * transaction rail that looked like a global feed would be claiming to know about writes other
 * people made, which this build has no index for and no way to learn.
 */

import { TransactionRail } from "@/components/transaction-rail";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  return (
    <div>
      <p className="hf-label">Transactions</p>
      <h1 className="hf-display mt-1">Writes sent from this browser</h1>

      <p className="hf-body mt-4 max-w-[80ch]">
        Six consensus stages, always all six, so a write shows how far it got rather than only naming
        where it stopped. Three of the stopping points are consensus failing to conclude rather than
        deciding anything: those are tagged transient and are the ones worth sending again.
      </p>

      <p className="hf-note mt-3 max-w-[80ch]">
        This list is held in this tab and nowhere else. It is not an index of the contract&apos;s
        activity and does not claim to be one: writes made from another browser are absent from it,
        and clearing this browser&apos;s storage empties it without changing anything on chain.
      </p>

      <div className="mt-8">
        <TransactionRail />
      </div>
    </div>
  );
}
