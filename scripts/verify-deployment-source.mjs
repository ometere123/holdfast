/**
 * Does the contract deployed at the configured address contain the source in this repo?
 *
 * Not "did it deploy". A deployment succeeding proves something is on chain; it does not
 * prove that the something is what the repository claims. This reads the deployed code
 * back off StudioNet and compares it to `contracts/Holdfast.py` byte-for-byte.
 */
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

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

/**
 * Line endings are transport, not content. A deployment made from a Windows checkout (or a CLI
 * that normalizes on write) can round-trip every line through `\r\n`, which change nothing a
 * Python interpreter or a reader sees but which would fail a byte-for-byte hash compare on that
 * account alone. Measured directly: `deploy` from a CRLF working tree put 3,452 extra bytes on
 * chain, one `\r` per line, over an otherwise identical file. Normalizing both sides to `\n`
 * before hashing is what keeps this check about the source and not about whose editor wrote it.
 */
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

const digest = (text) => createHash("sha256").update(normalizeEol(text), "utf8").digest("hex");

const local = readFileSync("contracts/Holdfast.py", "utf8");

const client = createClient({
  chain: studionet,
  account: createAccount(),
  endpoint: process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api",
});

const raw = await client.getContractCode(address);
const deployed = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

const localHash = digest(local);
const deployedHash = digest(deployed);

if (localHash !== deployedHash) {
  console.error("Deployed source does NOT match contracts/Holdfast.py");
    console.error(`  repo:     sha256 ${localHash} (${Buffer.byteLength(local, "utf8")} bytes)`);
    console.error(`  deployed: sha256 ${deployedHash} (${Buffer.byteLength(deployed, "utf8")} bytes)`);
  process.exit(1);
}
console.log(
  `Deployed source matches contracts/Holdfast.py (sha256 ${localHash.slice(0, 16)}, ` +
    `${Buffer.byteLength(local, "utf8")} bytes) at ${address}.`,
);
