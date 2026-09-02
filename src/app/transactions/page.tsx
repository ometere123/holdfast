/**
 * Every write this browser has sent, and where each one stopped.
 *
 * The list lives in this tab's own storage rather than on the contract, and the page says so. A
 * transaction rail that looked like a global feed would be claiming to know about writes other
 * people made, which this build has no index for and no way to learn.
 */

import { TransactionRail } from "@/components/transaction-rail";
import { WalletActivity, type WalletActivityRead } from "@/components/wallet-activity";
import { getBond, listBonds } from "@/lib/data-source";
import type { Bond } from "@/lib/contract-types";
import { dataMode } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const summaries = await listBonds();
  let activity: WalletActivityRead;
  if (summaries.kind !== "AVAILABLE") {
    activity = { kind: "unavailable", message: "The bond register could not be read." };
  } else {
    const reads = await Promise.all(summaries.value.map((bond) => getBond(bond.bond_id)));
    const failed = reads.find((read) => read.kind === "UNAVAILABLE" || read.kind === "INVALID_RESPONSE");
    activity = failed
      ? { kind: "unavailable", message: "One or more bond records could not be read." }
      : {
          kind: "available",
          bonds: reads.flatMap((read) => (read.kind === "AVAILABLE" ? [read.value] : [])) as Bond[],
          mode: dataMode,
        };
  }

  return (
    <div>
      <p className="hf-label">Activity</p>
      <h1 className="hf-display mt-1">Activity</h1>

      <p className="hf-body mt-4 max-w-[80ch]">
        See the bonds involving a connected wallet and the writes recorded by this browser. The
        contract register and the local write rail are deliberately kept as separate sources.
      </p>

      <WalletActivity read={activity} />

      <section aria-labelledby="browser-writes-heading" className="mt-12">
        <h2 id="browser-writes-heading" className="hf-heading">Recent writes from this browser</h2>
        <p className="hf-note mt-2 max-w-[70ch]">
          This is a local record of writes submitted from this browser. It is not complete chain
          history and may not include transactions sent from another device or browser.
        </p>
      </section>
      <div className="mt-4">
        <TransactionRail />
      </div>
    </div>
  );
}
