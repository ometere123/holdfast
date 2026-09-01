/**
 * Assert that the deployed method table carries every method the frontend calls.
 *
 * The list is imported from `src/lib/genlayer/config.ts` rather than written out here. An earlier
 * version of this script kept its own copy, and the copy drifted: it required `renew_bond` and
 * `stats`, neither of which the contract has ever defined, and it did not require `get_ledger` or
 * `get_limits`, which every page reads. A schema check against a list the contract does not
 * implement cannot pass, and a check that omits the methods the app actually calls passes while
 * proving nothing. One list, in the file the app reads, checked from here.
 *
 * Node 24 strips types from `.ts` on import, which is what lets a plain `.mjs` script share the
 * app's own constant instead of mirroring it.
 */

import { existsSync, readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { REQUIRED_METHODS } from "../src/lib/genlayer/config.ts";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...value] = trimmed.split("=");
    process.env[key] ??= value.join("=");
  }
}

const address = process.env.NEXT_PUBLIC_HOLDFAST_CONTRACT;
if (!address) {
  console.error("NEXT_PUBLIC_HOLDFAST_CONTRACT is not set.");
  process.exit(1);
}

const client = createClient({
  chain: studionet,
  account: createAccount(),
  endpoint: process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api",
});

const schema = await client.getContractSchema(address);
const table = schema.methods ?? {};
const missing = REQUIRED_METHODS.filter((method) => !table[method]);
if (missing.length) {
  console.error(`Missing methods: ${missing.join(", ")}`);
  process.exit(1);
}

// Reported, not enforced. A method on chain that the frontend does not call is not a failure, but
// it is the shape a half-finished redeployment takes, so it is named rather than passed over.
const extra = Object.keys(table).filter((method) => !REQUIRED_METHODS.includes(method));
if (extra.length) {
  console.log(`Also deployed, not called by this frontend: ${extra.join(", ")}`);
}

console.log(`Holdfast schema verified for ${address} (${REQUIRED_METHODS.length} methods).`);
