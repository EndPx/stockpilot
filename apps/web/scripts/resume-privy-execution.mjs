// Operator-only recovery after checking Privy resources. Never delegates a wallet
// or signs a transaction. An uncertain create is never retried automatically.
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { PrivyClient } from "@privy-io/node";
import { executionPolicy, provisioningDiagnostic, quorumDisplayName } from "./provision-privy-execution.mjs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIELDS = ["PRIVY_EXECUTION_SIGNER_ID", "PRIVY_EXECUTION_POLICY_ID", "PRIVY_EXECUTION_EXPIRES_AT", "PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY"];

export function parseResumeConfiguration(content, now = Date.now()) {
  const match = content.match(new RegExp(`^# StockPilot provisioning (${UUID}); expiry ([^\\r\\n]+)`, "m"));
  if (!match) throw new Error("Protected configuration has no valid provisioning run");
  const fields = {};
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("#") || line === "") continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator);
    if (separator < 1 || !FIELDS.includes(name) || Object.hasOwn(fields, name)) throw new Error("Protected configuration contains unexpected or duplicate fields");
    fields[name] = line.slice(separator + 1);
  }
  if (FIELDS.some((name) => typeof fields[name] !== "string")) throw new Error("Protected configuration is incomplete");
  const expiresAt = Date.parse(fields.PRIVY_EXECUTION_EXPIRES_AT);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 7 * 86_400_000 || expiresAt % 1000 !== 0 ||
      Date.parse(match[2]) !== expiresAt) throw new Error("Protected configuration expiry is invalid or expired");
  const signerId = fields.PRIVY_EXECUTION_SIGNER_ID;
  const policyId = fields.PRIVY_EXECUTION_POLICY_ID;
  if (![signerId, policyId].every((id) => id === "" || /^[A-Za-z0-9_-]{1,128}$/.test(id)) || (!signerId && policyId)) throw new Error("Protected configuration IDs are invalid");
  const privateKey = fields.PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(privateKey) || privateKey.length > 512) throw new Error("Protected authorization key format is invalid");
  let key;
  try { key = createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" }); }
  catch { throw new Error("Protected authorization key is invalid"); }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Protected key must be P-256");
  return { runId: match[1], expiresAt, signerId, policyId, privateKey,
    publicKey: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64") };
}

function configurationContent(config) {
  return `# StockPilot provisioning ${config.runId}; expiry ${new Date(config.expiresAt).toISOString()}\n` +
    "# Private authorization key. Never commit or print this file.\n" +
    `PRIVY_EXECUTION_SIGNER_ID=${config.signerId}\nPRIVY_EXECUTION_POLICY_ID=${config.policyId}\n` +
    `PRIVY_EXECUTION_EXPIRES_AT=${new Date(config.expiresAt).toISOString()}\n` +
    `PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY=${config.privateKey}\n`;
}

export async function resumeResources({ config, limits, privy, save, stage }) {
  const policy = executionPolicy(config.expiresAt, limits);
  if (config.signerId) {
    stage("verify_signer");
    const quorum = await privy.keyQuorums().get(config.signerId);
    if (quorum.id !== config.signerId || quorum.authorization_threshold !== 1 || quorum.authorization_keys?.length !== 1 ||
        quorum.authorization_keys[0].public_key !== config.publicKey || (quorum.user_ids?.length ?? 0) !== 0 ||
        (quorum.key_quorum_ids?.length ?? 0) !== 0) throw new Error("Existing quorum does not match the protected key");
  } else {
    stage("create_signer");
    const quorum = await privy.keyQuorums().create({ authorization_threshold: 1,
      display_name: quorumDisplayName(config.runId), public_keys: [config.publicKey] });
    if (typeof quorum.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(quorum.id)) throw new Error("Quorum creation returned an invalid ID; inspect Privy before retrying");
    config.signerId = quorum.id;
    stage("save_signer");
    await save(config);
  }
  if (config.policyId) throw new Error("Policy is already present; no resume creation needed");
  stage("create_policy");
  const created = await privy.policies().create({ ...policy, idempotency_key: `stockpilot-policy-${config.runId}` });
  if (typeof created.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(created.id)) throw new Error("Policy creation returned an invalid ID; inspect Privy before retrying");
  config.policyId = created.id;
  stage("save_policy");
  await save(config);
  return { signerId: config.signerId, policyId: config.policyId };
}

export async function resume(args) {
  const options = new Map(args.map((value) => {
    const at = value.indexOf("=");
    return at < 0 ? [value, "true"] : [value.slice(0, at), value.slice(at + 1)];
  }));
  if (args.length !== 4 || options.size !== 4 || options.get("--resume-after-resource-check") !== "true" ||
      !options.has("--output") || !options.has("--max-sol-lamports") || !options.has("--max-usdc-raw")) {
    throw new Error("Usage: --resume-after-resource-check --output=/absolute/protected/server.env --max-sol-lamports=EXPLICIT_RAW_U64 --max-usdc-raw=EXPLICIT_RAW_U64");
  }
  const output = options.get("--output");
  if (process.platform === "win32" || !isAbsolute(output)) throw new Error("Resume requires an absolute protected path on Linux");
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) throw new Error("Protected parent must be a real 0700 directory");
  const original = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
  let config;
  try {
    const stat = await original.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 4096) throw new Error("Protected configuration must be a single regular 0600 file");
    config = parseResumeConfiguration(await original.readFile("utf8"));
  } finally { await original.close(); }
  if (config.policyId) throw new Error("Configuration already has a policy; refusing provisioning retry");
  const limits = { maxSolLamports: options.get("--max-sol-lamports"), maxUsdcRaw: options.get("--max-usdc-raw") };
  executionPolicy(config.expiresAt, limits);
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) throw new Error("PRIVY_APP_SECRET is required on the server");
  const lock = await open(`${output}.resume.lock`, "wx", 0o600);
  await lock.close();
  let currentStage = "initialize_client";
  try {
    const privy = new PrivyClient({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmudnl6lc00lv0dl587wr6mj9",
      appSecret, maxRetries: 0, timeout: 15_000, logLevel: "off" });
    const save = async (value) => {
      // Never truncate the sole copy of the private key. Fully persist a protected
      // replacement before atomically exchanging it for the previous file.
      const temporary = `${output}.resume-${randomUUID()}`;
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(configurationContent(value)); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, output);
      const directory = await open(dirname(output), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    };
    const result = await resumeResources({ config, limits, privy, save, stage: (value) => { currentStage = value; } });
    // Retain the one-shot guard on success too: another process may have read
    // the old partial configuration before this attempt acquired its lock.
    process.stdout.write(`Resumed StockPilot signer ${result.signerId} and policy ${result.policyId}. Protected configuration saved. No wallet was delegated.\n`);
  } catch (error) {
    // Keep lock on every failed attempt: a human must investigate resources before
    // removing this guard. A timeout is not evidence that creation failed.
    throw new Error(`Resume stopped (${provisioningDiagnostic(currentStage, error, [appSecret, config.privateKey, config.publicKey])}). Preserve protected files and check Privy resources before another attempt; resume lock retained.`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  resume(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Resume failed"}\n`);
    process.exitCode = 1;
  });
}
