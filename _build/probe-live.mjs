/**
 * Throwaway probe: is anything actually registered at the deployed address?
 *
 * A GenLayer deploy can report ACCEPTED, report FINALIZED, and hand back an address while
 * registering nothing at all. That is what a missing `Depends` runtime pin does, and this
 * project has one dead address on record from exactly that. `getContractCode` returning the
 * right bytes is necessary but not sufficient: the question this answers is whether the class
 * is live enough to answer a view call.
 *
 * Not part of `npm run verify`. Lives in `_build/` because it is a one-time check whose real
 * successor is `scripts/exercise-studionet.mjs`.
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

const address = process.env.NEXT_PUBLIC_HOLDFAST_CONTRACT;
if (!address) throw new Error("NEXT_PUBLIC_HOLDFAST_CONTRACT is not set");

const client = createClient({
  chain: studionet,
  account: createAccount(),
  endpoint: process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [functionName, args] of [
  ["get_limits", []],
  ["get_ledger", []],
  ["list_bonds", []],
]) {
  try {
    const value = await client.readContract({ address, functionName, args });
    console.log(`\n=== ${functionName} ===`);
    console.log(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? String(v) : v), 2));
  } catch (error) {
    console.log(`\n=== ${functionName} FAILED ===`);
    console.log(String(error?.message ?? error).slice(0, 600));
  }
  await sleep(4500);
}
