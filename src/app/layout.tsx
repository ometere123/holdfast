/**
 * The reader housing: everything that is on screen before a bond is chosen.
 *
 * Three things are mounted here rather than per page, because each of them is a claim about the
 * whole interface and repeating it per route would let one route quietly stop making it.
 *
 * The provenance line comes first, above the title, and it is not dismissible. `dataProvenance()`
 * has three distinct answers and one of them is the awkward one: live mode requested with no
 * contract address configured, which silently falls back to fixtures. A banner that only appeared
 * in fixture mode would be absent in exactly that case.
 *
 * The wallet control is in the header and nowhere else. It is one button, because a chooser panel
 * offering a generated key alongside an injected wallet invites someone to stake real value on a
 * key the page made up.
 *
 * `WalletProvider` wraps `TransactionProvider` and not the other way round: the transaction list
 * re-reads mid-flight rows from the chain, and it needs a client before it can do that.
 */

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { TransactionProvider } from "@/components/transaction-provider";
import { WalletControl } from "@/components/wallet-control";
import { WalletProvider } from "@/components/wallet-provider";
import { dataProvenance } from "@/lib/data-source";

export const metadata: Metadata = {
  title: "Holdfast",
  description:
    "Stake a bond on a published commitment and let anyone check it against the Internet Archive, inside consensus.",
};

const NAV = [
  { href: "/", label: "Bonds" },
  { href: "/create", label: "Bond a page" },
  { href: "/method", label: "Method" },
  { href: "/transactions", label: "Transactions" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const provenance = dataProvenance();

  return (
    <html lang="en">
      <body>
        <a className="hf-skip hf-record" href="#main">
          Skip to the record
        </a>

        <WalletProvider>
          <TransactionProvider>
            <div className="mx-auto w-full max-w-[1180px] px-5 strip:px-8">
              <p
                className="hf-note border-b py-3"
                style={{ borderColor: "var(--rule-strong)" }}
                data-data-mode={provenance.mode}
              >
                <span className="hf-label hf-label-ink mr-2">
                  {provenance.mode === "live" ? "Live" : "Fixtures"}
                </span>
                {provenance.line}
              </p>

              <header className="pt-8 pb-5">
                <div className="flex flex-col gap-5 strip:flex-row strip:items-start strip:justify-between">
                  <div>
                    <Link href="/" className="hf-display block no-underline">
                      Holdfast
                    </Link>
                    <p className="hf-note mt-1 max-w-[64ch]">
                      A bond staked on a sentence somebody published, checked against the archived
                      record of the page it was published on, by anyone, from a button.
                    </p>
                  </div>
                  <WalletControl />
                </div>

                <nav className="mt-6" aria-label="Sections">
                  <ul className="flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
                    {NAV.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href} className="hf-label hf-label-ink no-underline">
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="hf-rail mt-4" aria-hidden="true" />
              </header>

              <main id="main" className="pb-16">
                {children}
              </main>

              <footer className="border-t py-8" style={{ borderColor: "var(--rule-strong)" }}>
                <p className="hf-note max-w-[76ch]">
                  Every reading on this site is a reading of archived text, quoted from it. It is
                  not a legal determination, and an unreachable archive is never reported as an
                  intact commitment or as a broken one.
                </p>
                <p className="hf-note mt-2 max-w-[76ch]">
                  Apache-2.0. The contract is the authority for every number printed here; the
                  interface reads them and does not invent them.
                </p>
              </footer>
            </div>
          </TransactionProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
