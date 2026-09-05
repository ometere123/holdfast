/**
 * Regression coverage for the defect a live create_bond attempt hit in the browser: this app's
 * write path used to call genlayer-js's `client.connect()`, which probes for a MetaMask Snap
 * (`wallet_getSnaps`, then `wallet_requestSnaps` if the Snap is missing) before a signature is
 * ever requested. A generic injected EIP-1193 wallet that does not implement Snaps at all --
 * Rabby is the shape modelled here, and it is also what a Snap-less MetaMask does -- throws on
 * that first probe, so the write never reached the point of asking for a signature. Holdfast
 * supports injected wallets only and never asks a wallet to install anything, so no `*Snaps`
 * method should ever be sent, on any path: chain already correct, chain switch, chain add, or a
 * declined signature.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createInjectedClient, ensureChain } from "../src/lib/genlayer/client.ts";
import { chain } from "../src/lib/genlayer/config.ts";

const STUDIONET_HEX = `0x${chain.id.toString(16)}`;

/** A Rabby-style provider: implements the standard EIP-1193 surface and nothing Snap-shaped. */
function makeRabbyLikeProvider({ chainId = STUDIONET_HEX, onSwitch, onSend } = {}) {
  let currentChainId = chainId;
  const calls = [];
  const provider = {
    calls,
    request: async ({ method, params }) => {
      calls.push(method);
      if (/Snaps/i.test(method)) {
        // The exact failure observed live: a real Rabby-style wallet has no handler for this.
        throw { code: -32601, message: `method [${method}] doesn't has corresponding handler` };
      }
      if (method === "eth_chainId") return currentChainId;
      if (method === "wallet_switchEthereumChain") {
        if (onSwitch) {
          const result = await onSwitch(params[0].chainId);
          if (result === "switched") currentChainId = params[0].chainId;
          return null;
        }
        currentChainId = params[0].chainId;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        currentChainId = params[0].chainId;
        return null;
      }
      if (method === "eth_sendTransaction") {
        if (onSend) return onSend(params[0]);
        return "0xaaaabbbbccccdddd0000111122223333444455556666777788889999aaaabb";
      }
      throw new Error(`unmocked method in test: ${method}`);
    },
  };
  return provider;
}

function withGlobalWindow(provider, run) {
  const previous = globalThis.window;
  globalThis.window = { ethereum: provider };
  return run().finally(() => {
    globalThis.window = previous;
  });
}

test("ensureChain does nothing, and touches no *Snaps method, when already on the right chain", async () => {
  const provider = makeRabbyLikeProvider({ chainId: STUDIONET_HEX });
  await ensureChain(provider);
  assert.deepEqual(provider.calls, ["eth_chainId"]);
});

test("ensureChain switches via wallet_switchEthereumChain and never calls a *Snaps method", async () => {
  const provider = makeRabbyLikeProvider({ chainId: "0x1", onSwitch: async () => "switched" });
  await ensureChain(provider);
  assert.deepEqual(provider.calls, ["eth_chainId", "wallet_switchEthereumChain"]);
  assert.ok(provider.calls.every((method) => !/Snaps/i.test(method)));
});

test("ensureChain falls back to wallet_addEthereumChain on switch error 4902, still no *Snaps call", async () => {
  const provider = makeRabbyLikeProvider({
    chainId: "0x1",
    onSwitch: async () => {
      throw { code: 4902, message: "Unrecognized chain" };
    },
  });
  await ensureChain(provider);
  assert.deepEqual(provider.calls, [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ]);
});

test("ensureChain re-raises a switch refusal that is not 4902, and never tries to add or install a Snap", async () => {
  const provider = makeRabbyLikeProvider({
    chainId: "0x1",
    onSwitch: async () => {
      throw { code: 4001, message: "User rejected the request." };
    },
  });
  await assert.rejects(() => ensureChain(provider), (error) => error.code === 4001);
  assert.deepEqual(provider.calls, ["eth_chainId", "wallet_switchEthereumChain"]);
});

test("createInjectedClient throws a plain message when no injected provider exists, before any RPC call", async () => {
  await withGlobalWindow(undefined, async () => {
    await assert.rejects(
      () => createInjectedClient("0x1111111111111111111111111111111111111111"),
      /No injected wallet was found/,
    );
  });
});

/** Answers the plain JSON-RPC reads genlayer-js's transport makes for anything not in its
 * fixed provider-method allowlist (eth_getTransactionCount, eth_gasPrice, eth_estimateGas). */
function stubRpcFetch() {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const answers = {
      eth_getTransactionCount: "0x0",
      eth_gasPrice: "0x3b9aca00",
      eth_estimateGas: "0x5208",
    };
    const result = answers[body.method];
    if (result === undefined) throw new Error(`unmocked RPC method in test: ${body.method}`);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result }) };
  };
  return () => {
    globalThis.fetch = previous;
  };
}

test("a Rabby-style wallet can sign a real write end to end, with no *Snaps method ever sent", async () => {
  const restoreFetch = stubRpcFetch();
  const address = "0x1111111111111111111111111111111111111111";
  const provider = makeRabbyLikeProvider({ chainId: STUDIONET_HEX });
  try {
    await withGlobalWindow(provider, async () => {
      const client = await createInjectedClient(address);
      const hash = await client.writeContract({
        address: "0x0D656F1A319Dad705eeE9CF25045CF22a05776B9",
        functionName: "check_commitment",
        args: ["hf-live-evidence-1"],
        value: 0n,
      });
      assert.equal(hash, "0xaaaabbbbccccdddd0000111122223333444455556666777788889999aaaabb");
    });
  } finally {
    restoreFetch();
  }
  assert.ok(provider.calls.includes("eth_sendTransaction"));
  assert.ok(provider.calls.every((method) => !/Snaps/i.test(method)));
});

test("a user rejection (4001) on the signature itself surfaces as a rejection, with no *Snaps method sent", async () => {
  const restoreFetch = stubRpcFetch();
  const address = "0x1111111111111111111111111111111111111111";
  const provider = makeRabbyLikeProvider({
    chainId: STUDIONET_HEX,
    onSend: () => {
      throw { code: 4001, message: "User rejected the request." };
    },
  });
  try {
    await withGlobalWindow(provider, async () => {
      const client = await createInjectedClient(address);
      await assert.rejects(
        () =>
          client.writeContract({
            address: "0x0D656F1A319Dad705eeE9CF25045CF22a05776B9",
            functionName: "check_commitment",
            args: ["hf-live-evidence-1"],
            value: 0n,
          }),
        (error) => error.code === 4001,
      );
    });
  } finally {
    restoreFetch();
  }
  assert.ok(provider.calls.includes("eth_sendTransaction"));
  assert.ok(provider.calls.every((method) => !/Snaps/i.test(method)));
});
