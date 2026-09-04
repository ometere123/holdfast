import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, GenLayerClient, TransactionHash } from "genlayer-js/types";
import { CONTRACT_ADDRESS, REQUIRED_METHODS } from "./config.ts";
import { createReadClient } from "./read-client.ts";
import { assertSuccessfulGenVMExecution, inspectGenVMExecution } from "./execution.ts";
import { returnedFromTransaction, type ReturnedValue } from "./returned-value.ts";
import { normalizeError } from "../wallet-errors.ts";

export type Client = GenLayerClient<typeof import("./config").chain>;

/**
 * Does the deployed contract still have every method this frontend calls?
 *
 * Worth having as a first-class read rather than discovering a rename at the moment a
 * user clicks. `scripts/verify-schema.mjs` asks the same question in CI.
 */
export async function verifyContractSchema() {
  if (!CONTRACT_ADDRESS) return { ok: false, missing: REQUIRED_METHODS, configured: false };
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  const schema = await readMaybe<{ methods: Record<string, unknown> }>(() =>
    client.getContractSchema(address),
  );
  if (!schema) return { ok: false, missing: REQUIRED_METHODS, configured: true };
  const missing = REQUIRED_METHODS.filter((method) => !schema.methods[method]);
  return { ok: missing.length === 0, missing, configured: true };
}

export async function writeContract(
  client: Client,
  functionName: string,
  args: CalldataEncodable[],
  value: bigint,
) {
  if (!CONTRACT_ADDRESS) throw new Error("No deployed contract address is configured.");
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
    consensusMaxRotations: 3,
  });
  return hash as TransactionHash;
}

/**
 * View calls fail loudly for reasons that are not errors from the page's point of view:
 * an id that does not exist yet, a rate-limited public endpoint, a pool that is
 * momentarily full. Those become `undefined`; anything else is rethrown, because
 * swallowing a real fault would be a worse lie than showing it.
 */
export async function readMaybe<T>(read: () => Promise<unknown>): Promise<T | undefined> {
  try {
    return (await read()) as T;
  } catch (error) {
    const message = normalizeError(error);
    if (
      message.includes("execution failed") ||
      message.includes("Missing or invalid parameters") ||
      message.includes("Rate limit exceeded") ||
      message.includes("QueuePool limit") ||
      message.includes("Unexpected token")
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Waits for finality, then re-reads the transaction and inspects the leader receipt.
 *
 * A receipt arriving is not the same as the contract having succeeded: a rolled-back
 * write still finalizes. And a payable method that refunds and returns `[EXTERNAL] ...`
 * finalizes with GenVM SUCCESS while having refused the request, which is why `returned`
 * is carried out separately rather than folded into a boolean.
 */
export type FinalizedExecution = {
  status: string;
  executionResult: "SUCCESS" | "ROLLBACK" | "ERROR" | "UNKNOWN";
  executionError?: string;
  returned: ReturnedValue;
};

export async function getFinalizedExecution(
  client: Client,
  hash: TransactionHash,
): Promise<FinalizedExecution> {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 90,
  });
  const finalized = await client.getTransaction({ hash });
  const outcome = inspectGenVMExecution(finalized);
  return {
    status: String(receipt.statusName ?? receipt.status ?? "FINALIZED"),
    ...outcome,
    returned: returnedFromTransaction(finalized),
  };
}

export async function waitAccepted(client: Client, hash: TransactionHash) {
  const outcome = await getFinalizedExecution(client, hash);
  assertSuccessfulGenVMExecution(
    {
      consensus_data: {
        leader_receipt: [
          {
            execution_result: outcome.executionResult,
            error: outcome.executionError ?? null,
          },
        ],
      },
    },
    hash,
  );
  return outcome;
}
