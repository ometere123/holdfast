/**
 * Throwaway: what happened to one transaction hash?
 *
 * `typed-write` polls for its own receipt and holds the terminal while it does. When a call makes
 * two archive fetches and an LLM round, that wait can outlast the shell that started it, and the
 * question of whether the transaction succeeded is separate from whether the CLI was still
 * watching. This asks the node directly.
 *
 * Prints the leader's outcome and the tagged payload, plus any value-carrying messages, and
 * nothing else. Not part of `npm run verify`.
 */
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { existsSync, readFileSync } from "node:fs";

const envPath = "C:/Users/USER/Desktop/latestprojects/holdfast/.env.local";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...value] = trimmed.split("=");
    process.env[key] ??= value.join("=");
  }
}

const hash = process.argv[2];
if (!hash) throw new Error("usage: node tx-status.mjs <hash>");

const client = createClient({
  chain: studionet,
  account: createAccount(),
  endpoint: process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api",
});

const tx = await client.getTransaction({ hash });
const leader = tx?.consensus_data?.leader_receipt?.[0] ?? null;

const said = (() => {
  const payload = leader?.result?.payload;
  if (payload === undefined || payload === null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload.readable === "string") {
    try {
      return JSON.parse(payload.readable);
    } catch {
      return payload.readable;
    }
  }
  return payload;
})();

console.log(JSON.stringify({
  hash,
  status_name: tx?.status_name ?? tx?.status ?? null,
  result_name: tx?.result_name ?? null,
  created_at: tx?.created_at ?? null,
  recipient: tx?.to_address ?? tx?.recipient ?? null,
  execution_result: leader?.execution_result ?? null,
  leader_status: leader?.result?.status ?? null,
  exit_code: leader?.result?.exit_code ?? null,
  said,
  votes: tx?.consensus_data?.votes ?? null,
  messages: (tx?.messages ?? []).map((m) => ({
    recipient: m.recipient,
    value: String(m.value),
    onAcceptance: m.onAcceptance,
  })),
}, null, 2));
