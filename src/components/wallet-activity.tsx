"use client";

import Link from "next/link";
import type { Bond } from "@/lib/contract-types";
import { formatGen, displayDay, shortenHex } from "@/lib/format";
import { sameAddress } from "@/lib/contract-types";
import { useWallet } from "./wallet-provider";

export type WalletActivityRead =
  | { kind: "available"; bonds: Bond[]; mode: "live" | "fixtures" }
  | { kind: "unavailable"; message: string };

function roleFor(bond: Bond, address: string): string {
  const roles: string[] = [];
  if (sameAddress(bond.promisor, address)) roles.push("promisor");
  if (sameAddress(bond.payee, address)) roles.push("payee");
  return roles.join(" and ");
}

function bondUrl(value: string): string {
  try {
    return new URL(value).hostname + new URL(value).pathname;
  } catch {
    return value;
  }
}

export function WalletActivity({ read }: { read: WalletActivityRead }) {
  const wallet = useWallet();

  return (
    <section aria-labelledby="wallet-activity-heading" className="mt-8">
      <h2 id="wallet-activity-heading" className="hf-heading">
        Connected wallet activity
      </h2>
      <p className="hf-note mt-2 max-w-[70ch]">
        Bonds involving this wallet, reconstructed from the current Holdfast contract state. This is
        not a complete transaction history.
      </p>

      {wallet.mode !== "injected" || !wallet.address ? (
        <p className="hf-note mt-5 border p-4" style={{ borderColor: "var(--rule-strong)" }}>
          Connect a wallet to see bonds where this address is the promisor or payee.
        </p>
      ) : read.kind === "unavailable" ? (
        <p className="hf-note mt-5 border p-4" style={{ borderColor: "var(--diazo)" }}>
          Live Holdfast data is currently unavailable. {read.message}
        </p>
      ) : (
        <div className="mt-5">
          {read.mode === "fixtures" ? (
            <p className="hf-record-sm mb-3">Fixture bond register — not chain state.</p>
          ) : null}
          {read.bonds.filter((bond) => roleFor(bond, wallet.address!).length > 0).length === 0 ? (
            <p className="hf-note border p-4" style={{ borderColor: "var(--rule-strong)" }}>
              No current bond lists this wallet as promisor or payee.
            </p>
          ) : (
            <ul className="list-none p-0">
              {read.bonds
                .filter((bond) => roleFor(bond, wallet.address!).length > 0)
                .map((bond) => (
                  <li key={bond.bond_id} className="hf-rule py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <Link className="hf-body underline" href={`/bonds/${bond.bond_id}`}>
                        {bond.bond_id}
                      </Link>
                      <span className="hf-record hf-tag">{roleFor(bond, wallet.address!)}</span>
                    </div>
                    <dl className="mt-3 grid gap-x-8 gap-y-2 strip:grid-cols-2">
                      <div>
                        <dt className="hf-label">State</dt>
                        <dd className="hf-record mt-1">{bond.state}</dd>
                      </div>
                      <div>
                        <dt className="hf-label">Stake</dt>
                        <dd className="hf-record mt-1">{formatGen(bond.stake)}</dd>
                      </div>
                      <div>
                        <dt className="hf-label">Page</dt>
                        <dd className="hf-record mt-1 break-words" title={bond.url}>
                          {bondUrl(bond.url)}
                        </dd>
                      </div>
                      <div>
                        <dt className="hf-label">Expires</dt>
                        <dd className="hf-record mt-1">{displayDay(bond.expires_at)}</dd>
                      </div>
                    </dl>
                    <p className="hf-record-sm mt-3" title={bond.promisor}>
                      promisor {shortenHex(bond.promisor)} · payee {shortenHex(bond.payee)}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
