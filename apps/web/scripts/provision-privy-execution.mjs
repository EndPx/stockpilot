// Explicit operator setup; never run from an HTTP request or during an app build.
// Does not attach a signer to any user wallet and does not sign a transaction.
import { randomUUID } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAX_U64 = 18_446_744_073_709_551_615n;

function providerCeiling(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > MAX_U64) {
    throw new Error("Provider ceilings must be explicit positive raw-unit u64 amounts");
  }
  return value;
}

// These are operator-chosen provider ceilings, not defaults or owner spending limits.
// StockPilot's exact transaction verifier and durable per-agent policy remain mandatory.
export function executionPolicy(expiresAtMs, { maxSolLamports, maxUsdcRaw } = {}) {
  if (!Number.isSafeInteger(expiresAtMs)) throw new Error("Invalid policy expiration");
  const solCeiling = providerCeiling(maxSolLamports);
  const usdcCeiling = providerCeiling(maxUsdcRaw);
  const expiry = { field_source: "system", field: "current_unix_timestamp",
    operator: "lt", value: String(Math.floor(expiresAtMs / 1000)) };
  return {
    version: "1.0", chain_type: "solana", name: "StockPilot agent execution",
    rules: [
      { name: "Verified swaps and associated accounts", method: "signTransaction", action: "ALLOW",
        conditions: [expiry, { field_source: "solana_program_instruction", field: "programId", operator: "in", value: [
          "ComputeBudget111111111111111111111111111111",
          "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
          "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        ] }] },
      { name: "SOL transfer provider ceiling", method: "signTransaction", action: "ALLOW",
        conditions: [expiry,
          { field_source: "solana_system_program_instruction", field: "instructionName", operator: "eq", value: "Transfer" },
          { field_source: "solana_system_program_instruction", field: "Transfer.lamports", operator: "lte", value: solCeiling },
        ] },
      { name: "USDC transfer provider ceiling", method: "signTransaction", action: "ALLOW",
        conditions: [expiry,
          { field_source: "solana_token_program_instruction", field: "instructionName", operator: "eq", value: "TransferChecked" },
          { field_source: "solana_token_program_instruction", field: "TransferChecked.mint", operator: "eq", value: USDC },
          { field_source: "solana_token_program_instruction", field: "TransferChecked.amount", operator: "lte", value: usdcCeiling },
        ] },
    ],
  };
}

export async function provision(args) {
  const options = new Map(args.filter((value) => value.startsWith("--")).map((value) => {
    const separator = value.indexOf("=");
    return separator < 0 ? [value, "true"] : [value.slice(0, separator), value.slice(separator + 1)];
  }));
  if (options.get("--provision") !== "true" || options.size !== 5 ||
      !options.has("--output") || !options.has("--expires-at") ||
      !options.has("--max-sol-lamports") || !options.has("--max-usdc-raw")) {
    throw new Error("Usage: node scripts/provision-privy-execution.mjs --provision --output=/absolute/protected/new.env --expires-at=ISO_TIMESTAMP --max-sol-lamports=EXPLICIT_RAW_U64 --max-usdc-raw=EXPLICIT_RAW_U64");
  }
  const output = options.get("--output");
  // Match the provider's whole-second policy boundary exactly in runtime config.
  const expiresAt = Math.floor(Date.parse(options.get("--expires-at")) / 1000) * 1000;
  if (!isAbsolute(output) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 7 * 86_400_000) {
    throw new Error("An absolute output path and future expiration within seven days are required");
  }
  const policyInput = executionPolicy(expiresAt, { maxSolLamports: options.get("--max-sol-lamports"), maxUsdcRaw: options.get("--max-usdc-raw") });
  if (process.platform === "win32") throw new Error("Run provisioning on the Linux server in a protected directory");
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("Output parent must be a real protected directory");
  if ((parent.mode & 0o077) !== 0) throw new Error("Output directory permissions must be 0700");
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmudnl6lc00lv0dl587wr6mj9";
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) throw new Error("PRIVY_APP_SECRET is required on the server");
  const file = await open(output, "wx", 0o600);
  const runId = randomUUID();
  let signerId = "";
  let policyId = "";
  try {
    const key = await generateP256KeyPair();
    async function save() {
      const content = `# StockPilot provisioning ${runId}; expiry ${new Date(expiresAt).toISOString()}\n` +
        `# Private authorization key. Never commit or print this file.\n` +
        `PRIVY_EXECUTION_SIGNER_ID=${signerId}\nPRIVY_EXECUTION_POLICY_ID=${policyId}\n` +
        `PRIVY_EXECUTION_EXPIRES_AT=${new Date(expiresAt).toISOString()}\n` +
        `PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY=${key.privateKey}\n`;
      await file.truncate(0);
      await file.write(content, 0, "utf8");
      await file.sync();
    }
    // Save the key before creating anything remotely, including on an ambiguous API response.
    await save();
    const privy = new PrivyClient({ appId, appSecret, maxRetries: 0, timeout: 15_000 });
    const quorum = await privy.keyQuorums().create({ authorization_threshold: 1,
      display_name: `StockPilot execution ${runId}`, public_keys: [key.publicKey] });
    signerId = quorum.id;
    await save();
    const policy = await privy.policies().create({ ...policyInput,
      idempotency_key: `stockpilot-policy-${runId}` });
    policyId = policy.id;
    await save();
    process.stdout.write(`Created StockPilot signer ${signerId} and policy ${policyId}. Protected configuration saved. No wallet was delegated.\n`);
  } catch {
    // Keep the protected partial configuration to investigate an uncertain creation.
    // Do not print SDK errors: they may include request data.
    throw new Error(`Provisioning did not complete. Inspect the protected output and Privy resources for run ${runId} before retrying.`);
  } finally { await file.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  provision(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed"}\n`);
    process.exitCode = 1;
  });
}
