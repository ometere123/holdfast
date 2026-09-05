"use client";

import { createClient } from "genlayer-js";
import { chain, GENLAYER_ENDPOINT } from "./config.ts";

/**
 * Chain verification and switching, done by hand rather than through genlayer-js's own
 * `client.connect()`.
 *
 * `connect()` is written for MetaMask specifically: after the chain check below, it goes on
 * to call `wallet_getSnaps` and, if the GenLayer wallet Snap is missing, `wallet_requestSnaps`
 * to install one. Every other injected wallet (Rabby, Coinbase Wallet, Brave, and MetaMask
 * itself when Snaps are unsupported) throws on `wallet_getSnaps` before a signature is ever
 * requested, since it is not a method any of them implement. This app supports generic
 * injected EIP-1193 wallets only and never asks a wallet to install anything, so no `*Snaps`
 * method is ever sent. The write path is `eth_sendTransaction` alone, which every one of
 * these wallets already implements.
 */
export async function ensureChain(provider: NonNullable<Window["ethereum"]>) {
  const chainIdHex = `0x${chain.id.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (current === chainIdHex) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError) {
    // 4902: the wallet has never seen this chain. Every other failure (including the person
    // declining) is rethrown rather than papered over with an add attempt that cannot help.
    const code = (switchError as { code?: number } | undefined)?.code;
    if (code !== 4902) throw switchError;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          rpcUrls: chain.rpcUrls.default.http,
          nativeCurrency: chain.nativeCurrency,
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
        },
      ],
    });
  }
}

export async function createInjectedClient(address: `0x${string}`) {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!provider) throw new Error("No injected wallet was found in this browser.");
  await ensureChain(provider);
  return createClient({ chain, endpoint: GENLAYER_ENDPOINT, account: address, provider });
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}
