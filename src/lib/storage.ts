/**
 * localStorage, kept in one file so nothing else has to know a key name or guard against
 * `localStorage` being absent during server rendering.
 *
 * The transaction list is a local record of what this browser sent. It is not evidence about
 * a bond: the bond's own record lives on chain and is read through `data-source.ts`. Losing
 * this list loses nothing except convenience, which is why it is allowed to live in a place a
 * person can clear.
 */

import type { StoredTransaction } from "./contract-types.ts";

const TX_KEY = "holdfast.transactions.v1";

/**
 * Written by earlier experimental builds that generated a StudioNet key in the browser.
 * Holdfast supports injected wallets only. Nothing reads these names; they exist here to be
 * removed, because deleting a feature is not a reason to leave a plaintext private key behind
 * in a browser that used it. The wallet provider calls this once on mount.
 */
const LEGACY_GENERATED_KEY = "holdfast.generated-wallet.v1";
const LEGACY_ACK_KEY = "holdfast.generated-wallet-ack.v1";

export function readTransactions(): StoredTransaction[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(TX_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as StoredTransaction[]) : [];
  } catch {
    return [];
  }
}

export function writeTransactions(items: StoredTransaction[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TX_KEY, JSON.stringify(items.slice(0, 24)));
  } catch {
    // A full or blocked storage quota is not a reason to break the page.
  }
}

export function purgeLegacyGeneratedKey() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LEGACY_GENERATED_KEY);
  localStorage.removeItem(LEGACY_ACK_KEY);
}
