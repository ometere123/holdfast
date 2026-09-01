"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createInjectedClient } from "@/lib/genlayer/client";
import { chain, CHAIN_NAME } from "@/lib/genlayer/config";
import { purgeLegacyGeneratedKey } from "@/lib/storage";
import {
  chainIdHex,
  DISCONNECTED,
  nextWalletState,
  networkLabel,
  networkVerdict,
  parseChainId,
  writeGate,
  type NetworkVerdict,
  type WalletMode,
  type WalletState,
} from "@/lib/wallet-session";

export type { WalletMode };

type WalletContextValue = {
  mode: WalletMode;
  address?: `0x${string}`;
  hasInjected: boolean;
  connecting: boolean;
  error?: string;
  /** Where the wallet says it is. Writes are held back unless this is `expected`. */
  network: NetworkVerdict;
  /** What the masthead prints. Never this build's network name unless the wallet is on it. */
  networkName: string;
  canWrite: boolean;
  /** Why a write cannot be signed, or undefined when one can. */
  writeBlockedReason?: string;
  connectInjected: () => Promise<void>;
  /** Asks the wallet to move to the chain this build targets. */
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  getWriteClient: () => Promise<Awaited<ReturnType<typeof createInjectedClient>>>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(DISCONNECTED);
  const [hasInjected, setHasInjected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Detect the provider without touching it. Never auto-connect: a page load is not consent
  // to reveal an address.
  //
  // The same pass deletes anything an earlier generated-wallet build left behind. Holdfast
  // supports injected wallets only, and legacy key material is removed rather than migrated.
  useEffect(() => {
    queueMicrotask(() => {
      setHasInjected(Boolean(window.ethereum));
      purgeLegacyGeneratedKey();
    });
  }, []);

  // Follow the wallet for as long as a session is open. All three events matter: the address
  // on screen has to be the address that would sign, the chain has to be the chain the
  // transaction would go to, and a provider that dropped the connection must not leave a
  // stale session looking live.
  useEffect(() => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (wallet.mode !== "injected" || !provider?.on) return;

    const onAccounts = (...args: unknown[]) =>
      setWallet((current) =>
        nextWalletState(current, { type: "accounts-changed", accounts: args[0] }),
      );
    const onChain = (...args: unknown[]) =>
      setWallet((current) => nextWalletState(current, { type: "chain-changed", chainId: args[0] }));
    const onDisconnect = (...args: unknown[]) => {
      const detail = args[0];
      const message =
        detail && typeof detail === "object" && "message" in detail
          ? String((detail as { message: unknown }).message)
          : undefined;
      setWallet((current) => nextWalletState(current, { type: "provider-disconnected", message }));
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [wallet.mode]);

  const switchNetwork = useCallback(async () => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex(chain.id) }],
      });
      // The wallet answers with `chainChanged`, which the listener above records. Asking
      // again here would only duplicate what the event already says.
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setWallet((current) => ({
        ...current,
        error: `This wallet would not switch to ${CHAIN_NAME} (chain ${chain.id}): ${message} Add the network in the wallet itself, then connect again.`,
      }));
    }
  }, []);

  const connectInjected = useCallback(async () => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) {
      setWallet({ mode: "none", error: "No injected wallet was found in this browser." });
      return;
    }
    setConnecting(true);
    // A provider found here proves one exists even if none did at mount, so the gate copy
    // cannot keep claiming there is nothing to sign with.
    setHasInjected(true);
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as `0x${string}`[];
      const next = accounts?.[0];
      if (!next) {
        setWallet({ mode: "none", error: "The wallet returned no account." });
        return;
      }
      // Ask which chain before declaring the session open, so the first render already knows
      // whether a write may go out.
      const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
      setWallet(nextWalletState(DISCONNECTED, { type: "connected", address: next, chainId }));

      // On the wrong chain, ask once. A wallet that refuses says so, and writes stay shut.
      if (chainId !== undefined && chainId !== chain.id) {
        await switchNetwork();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setWallet((current) => nextWalletState(current, { type: "connection-refused", message }));
    } finally {
      setConnecting(false);
    }
  }, [switchNetwork]);

  // Forgets the session in this tab. A wallet cannot be made to revoke a site from here, so
  // the label says disconnect and means exactly this much.
  const disconnect = useCallback(() => {
    setWallet((current) => nextWalletState(current, { type: "forget" }));
  }, []);

  const getWriteClient = useCallback(async () => {
    // Gated here as well as in the UI, because this is the last point before a signature is
    // requested and a caller that skipped the gate must still not get a client pointed at
    // the wrong chain.
    const decision = writeGate(wallet, chain.id, CHAIN_NAME);
    if (!decision.canWrite || !wallet.address) {
      throw new Error(decision.message ?? "Connect a wallet before sending a transaction.");
    }
    return createInjectedClient(wallet.address);
  }, [wallet]);

  const value = useMemo(() => {
    const network = networkVerdict(wallet, chain.id);
    const gate = writeGate(wallet, chain.id, CHAIN_NAME);
    return {
      mode: wallet.mode,
      address: wallet.address,
      hasInjected,
      connecting,
      error: wallet.error,
      network,
      networkName: networkLabel(network, CHAIN_NAME),
      canWrite: gate.canWrite,
      writeBlockedReason: gate.message,
      connectInjected,
      switchNetwork,
      disconnect,
      getWriteClient,
    };
  }, [wallet, hasInjected, connecting, connectInjected, switchNetwork, disconnect, getWriteClient]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
