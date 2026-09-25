import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage,
  getAddressDecoder, getTransactionEncoder, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, signatureBytes, type Blockhash,
} from "@solana/kit";
import { createDelegatedSigner, DelegatedSignerError } from "../lib/privy/delegated-signer";
import { createExecutionReadinessGet } from "../app/api/control/execution-readiness/route";
import { AuthError } from "../lib/auth/errors";

process.env.AUTH_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "readiness-test-secret-at-least-32-bytes";

// Ephemeral offline fixture: never a funded account or a network transaction.
const keys = generateKeyPairSync("ed25519");
const walletAddress = getAddressDecoder().decode(keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const identity = { privyUserId: "did:privy:test-owner", walletAddress };
const now = 1_700_000_000_000;
const environment = {
  AGENT_EXECUTION_ENABLED: "true", PRIVY_APP_SECRET: "fixture-app-secret",
  PRIVY_EXECUTION_SIGNER_ID: "quorum-test", PRIVY_EXECUTION_POLICY_ID: "policy-test",
  PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY: "fixture-authorization-key",
  PRIVY_EXECUTION_EXPIRES_AT: new Date(now + 6 * 86_400_000).toISOString(),
};
type SignerDeps = NonNullable<Parameters<typeof createDelegatedSigner>[0]>;
type Options = Parameters<NonNullable<SignerDeps["createClient"]>>[0];

function transaction(options: { signed?: boolean; changed?: boolean; forged?: boolean } = {}) {
  const compiled = compileTransaction(pipe(createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(address(walletAddress), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: (options.changed ? "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4nH2e9m5T" : "11111111111111111111111111111111") as Blockhash,
      lastValidBlockHeight: 100n,
    }, message),
    (message) => appendTransactionMessageInstruction({ programAddress: address("11111111111111111111111111111111") }, message),
  ));
  return Buffer.from(getTransactionEncoder().encode({ ...compiled, signatures: {
    ...compiled.signatures,
    [walletAddress]: options.forged ? signatureBytes(new Uint8Array(64).fill(1))
      : options.signed ? signatureBytes(sign(null, Uint8Array.from(compiled.messageBytes), keys.privateKey)) : null,
  } })).toString("base64");
}

function fixture() {
  const linked = { id: "wallet-test", type: "wallet", chain_type: "solana", wallet_client_type: "privy",
    connector_type: "embedded", wallet_index: 0, address: walletAddress as string };
  const user: { id: string; linked_accounts: unknown } = { id: identity.privyUserId, linked_accounts: [linked] };
  const wallet: { id: string; address: string; chain_type: string; archived_at: number | null; additional_signers: unknown } = {
    id: linked.id, address: walletAddress, chain_type: "solana", archived_at: null,
    additional_signers: [{ signer_id: environment.PRIVY_EXECUTION_SIGNER_ID, override_policy_ids: [environment.PRIVY_EXECUTION_POLICY_ID] }],
  };
  const calls = { options: [] as Options[], users: [] as string[], wallets: [] as string[], sign: [] as unknown[] };
  const state = { time: now, advanceRead: 0, failRead: false, failSign: false, encoding: "base64", signed: transaction({ signed: true }) };
  const env: Record<string, string | undefined> = { ...environment };
  const signer = createDelegatedSigner({ environment: () => env, now: () => state.time,
    createClient: (options) => {
      calls.options.push(options);
      return {
        users: () => ({ _get: async (id) => { calls.users.push(id); state.time += state.advanceRead;
          if (state.failRead) throw new Error("provider secret body"); return user; } }),
        wallets: () => ({ get: async (id) => { calls.wallets.push(id); return wallet; }, solana: () => ({
          signTransaction: async (id, input) => {
            calls.sign.push({ id, input });
            if (state.failSign) throw new Error("provider secret body");
            return { encoding: state.encoding, signed_transaction: state.signed };
          },
        }) }),
      };
    },
  });
  return { signer, user, linked, wallet, calls, env, state };
}

test("delegated readiness freshly verifies owner, primary wallet and exact signer policy without returning secrets", async () => {
  const f = fixture();
  const result = await f.signer.getReadiness(identity);
  assert.deepEqual(result, { configured: true, enabled: true, ready: true, signerId: "quorum-test", policyId: "policy-test", reason: "READY" });
  assert.deepEqual(f.calls.users, [identity.privyUserId]);
  assert.deepEqual(f.calls.wallets, ["wallet-test"]);
  assert.equal(f.calls.options[0].maxRetries, 0);
  assert.equal(f.calls.options[0].timeout, 15_000);
  assert.doesNotMatch(JSON.stringify(result), /fixture-app-secret|fixture-authorization-key/);
  f.wallet.additional_signers = [];
  assert.equal((await f.signer.getReadiness(identity)).reason, "OWNER_CONSENT_REQUIRED");
  assert.equal(f.calls.users.length, 2);
});

test("delegated signer configuration and execution kill switch fail closed before provider access", async () => {
  for (const field of Object.keys(environment).filter((key) => key !== "AGENT_EXECUTION_ENABLED")) {
    const f = fixture(); delete f.env[field];
    assert.equal((await f.signer.getReadiness(identity)).reason, "NOT_CONFIGURED");
    assert.equal(f.calls.options.length, 0);
  }
  const f = fixture(); f.env.AGENT_EXECUTION_ENABLED = "false";
  assert.equal((await f.signer.getReadiness(identity)).reason, "EXECUTION_DISABLED");
  assert.equal(f.calls.options.length, 0);
});

test("expired or invalid provider authorization cannot appear ready or attempt signing", async () => {
  const expired = fixture(); expired.env.PRIVY_EXECUTION_EXPIRES_AT = new Date(now).toISOString();
  assert.equal((await expired.signer.getReadiness(identity)).reason, "SIGNER_EXPIRED");
  await assert.rejects(expired.signer.signTransaction(identity, input()), (e: unknown) =>
    e instanceof DelegatedSignerError && e.code === "SIGNER_EXPIRED");
  assert.equal(expired.calls.options.length, 0);
  const invalid = fixture(); invalid.env.PRIVY_EXECUTION_EXPIRES_AT = "not-a-date";
  assert.equal((await invalid.signer.getReadiness(identity)).reason, "NOT_CONFIGURED");
  assert.equal(invalid.calls.options.length, 0);
  const expiresWhileChecking = fixture();
  expiresWhileChecking.env.PRIVY_EXECUTION_EXPIRES_AT = new Date(now + 1000).toISOString();
  expiresWhileChecking.state.advanceRead = 1000;
  assert.equal((await expiresWhileChecking.signer.getReadiness(identity)).reason, "SIGNER_EXPIRED");
  assert.equal(expiresWhileChecking.calls.sign.length, 0);
});

test("delegated readiness rejects wrong owner, wallet identity, chain and archived wallets", async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.user.id = "did:privy:someone-else"; },
    (f: ReturnType<typeof fixture>) => { f.linked.address = "So11111111111111111111111111111111111111112"; },
    (f: ReturnType<typeof fixture>) => { f.wallet.id = "different-wallet-id"; },
    (f: ReturnType<typeof fixture>) => { f.wallet.address = "So11111111111111111111111111111111111111112"; },
    (f: ReturnType<typeof fixture>) => { f.wallet.chain_type = "ethereum"; },
    (f: ReturnType<typeof fixture>) => { f.wallet.archived_at = now; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    assert.equal((await f.signer.getReadiness(identity)).reason, "WALLET_MISMATCH");
    assert.equal(f.calls.sign.length, 0);
  }
});

test("delegated readiness requires exactly one configured signer override policy", async () => {
  for (const override_policy_ids of [undefined, [], ["different-policy"], ["policy-test", "another-policy"]]) {
    const f = fixture(); f.wallet.additional_signers = [{ signer_id: "quorum-test", override_policy_ids }];
    assert.equal((await f.signer.getReadiness(identity)).reason, "SIGNER_POLICY_MISMATCH");
  }
  const wrongSigner = fixture(); wrongSigner.wallet.additional_signers = [{ signer_id: "wrong", override_policy_ids: ["policy-test"] }];
  assert.equal((await wrongSigner.signer.getReadiness(identity)).reason, "OWNER_CONSENT_REQUIRED");
  const duplicate = fixture(); duplicate.wallet.additional_signers = [
    { signer_id: "quorum-test", override_policy_ids: ["policy-test"] },
    { signer_id: "quorum-test", override_policy_ids: ["policy-test"] },
  ];
  assert.equal((await duplicate.signer.getReadiness(identity)).reason, "SIGNER_POLICY_MISMATCH");
});

const input = () => ({ transaction: transaction(), idempotencyKey: "stockpilot-agent:request:123456", expiresAtMs: now + 60_000 });
test("delegated signing rechecks consent and preserves exact bytes, idempotency and expiry with no retry", async () => {
  const f = fixture();
  assert.equal(await f.signer.signTransaction(identity, input()), f.state.signed);
  assert.deepEqual(f.calls.sign, [{ id: "wallet-test", input: { transaction: input().transaction,
    idempotency_key: input().idempotencyKey, request_expiry: now + 60_000,
    authorization_context: { authorization_private_keys: [environment.PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY] },
  } }]);
  f.wallet.additional_signers = [];
  await assert.rejects(f.signer.signTransaction(identity, input()), (e: unknown) => e instanceof DelegatedSignerError && e.code === "OWNER_CONSENT_REQUIRED");
  assert.equal(f.calls.sign.length, 1);
});

test("delegated signing rejects invalid lifetime, idempotency and malformed transaction before provider access", async () => {
  for (const changes of [{ expiresAtMs: now }, { expiresAtMs: now + 120_001 }, { expiresAtMs: NaN },
    { idempotencyKey: "short" }, { transaction: "not-base64" }, { transaction: "A".repeat(1645) }]) {
    const f = fixture();
    await assert.rejects(f.signer.signTransaction(identity, { ...input(), ...changes }), (e: unknown) =>
      e instanceof DelegatedSignerError && e.code === "INVALID_SIGNING_REQUEST");
    assert.equal(f.calls.options.length, 0);
  }
  const expiredWhileChecking = fixture(); expiredWhileChecking.state.advanceRead = 60_000;
  await assert.rejects(expiredWhileChecking.signer.signTransaction(identity, input()), (e: unknown) =>
    e instanceof DelegatedSignerError && e.code === "INVALID_SIGNING_REQUEST");
  assert.equal(expiredWhileChecking.calls.sign.length, 0);
});

test("delegated signing rejects altered, forged and unsigned provider responses and hides errors", async () => {
  for (const signed of [transaction({ signed: true, changed: true }), transaction({ forged: true }), transaction()]) {
    const f = fixture(); f.state.signed = signed;
    await assert.rejects(f.signer.signTransaction(identity, input()), (e: unknown) =>
      e instanceof DelegatedSignerError && e.code === "SIGNING_UNAVAILABLE");
    assert.equal(f.calls.sign.length, 1);
  }
  const f = fixture(); f.state.failSign = true;
  await assert.rejects(f.signer.signTransaction(identity, input()), (e: unknown) =>
    e instanceof DelegatedSignerError && e.message === "SIGNING_UNAVAILABLE");
  assert.equal(f.calls.sign.length, 1);
  f.state.failRead = true;
  assert.equal((await f.signer.getReadiness(identity)).reason, "PRIVY_UNAVAILABLE");
});

test("execution readiness GET uses server owner identity and denies cross-origin before identity lookup", async () => {
  const f = fixture(); let owners = 0;
  const get = createExecutionReadinessGet({ owner: async () => { owners++; return identity; }, readiness: f.signer.getReadiness });
  for (const headers of [{}, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
    { origin: "https://evil.example", "sec-fetch-site": "same-origin" }] as Record<string, string>[]) {
    const result = await get(new Request("http://localhost:3000/api/control/execution-readiness", { headers }));
    assert.equal(result.status, 403);
  }
  assert.equal(owners, 0);
  const result = await get(new Request("http://localhost:3000/api/control/execution-readiness?walletAddress=untrusted", {
    headers: { "sec-fetch-site": "same-origin" },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const body = await result.json();
  assert.equal(body.walletAddress, walletAddress);
  assert.equal(body.readiness.ready, true);
  assert.equal((await get(new Request("http://localhost:3000/api/control/execution-readiness", {
    headers: { origin: "http://localhost:3000" },
  }))).status, 200);
  const denied = createExecutionReadinessGet({ owner: async () => { throw new AuthError("SESSION_INVALID", 401); },
    readiness: async () => { throw new Error("must not reach Privy"); } });
  assert.equal((await denied(new Request("http://localhost:3000/api/control/execution-readiness", {
    headers: { "sec-fetch-site": "same-origin" },
  }))).status, 401);
});

test("provisioning policy denies by default and requires explicit operator provider ceilings, not hidden purchase caps", async () => {
  const scriptUrl = new URL("../scripts/provision-privy-execution.mjs", import.meta.url).href;
  const { executionPolicy } = await import(scriptUrl);
  const limits = { maxSolLamports: "18446744073709551615", maxUsdcRaw: "42000000" };
  for (const input of [undefined, {}, { maxSolLamports: "100" }, { ...limits, maxSolLamports: "0" },
    { ...limits, maxUsdcRaw: "18446744073709551616" }, { ...limits, maxUsdcRaw: "1.1" }]) {
    assert.throws(() => executionPolicy(now, input), /explicit positive raw-unit u64/);
  }
  const policy = executionPolicy(now, limits);
  assert.equal(policy.chain_type, "solana");
  assert.equal(policy.rules.length, 3);
  for (const rule of policy.rules) {
    assert.equal(rule.method, "signTransaction");
    assert.equal(rule.action, "ALLOW");
    assert.deepEqual(rule.conditions[0], { field_source: "system", field: "current_unix_timestamp", operator: "lt", value: String(now / 1000) });
  }
  assert.deepEqual(policy.rules[0].conditions[1].value, ["ComputeBudget111111111111111111111111111111", "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);
  assert.deepEqual(policy.rules[1].conditions.at(-1), { field_source: "solana_system_program_instruction", field: "Transfer.lamports", operator: "lte", value: limits.maxSolLamports });
  assert.equal(policy.rules[2].conditions[2].value, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(policy.rules[2].conditions[3].value, limits.maxUsdcRaw);
});
