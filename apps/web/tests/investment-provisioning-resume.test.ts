import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const { quorumDisplayName, provisioningDiagnostic } = await import(new URL("../scripts/provision-privy-execution.mjs", import.meta.url).href);
const { parseResumeConfiguration, resumeResources } = await import(new URL("../scripts/resume-privy-execution.mjs", import.meta.url).href);
const runId = "11111111-2222-4333-8444-555555555555";
const now = 1_800_000_000_000;
const expiresAt = now + 86_400_000;
const limits = { maxSolLamports: "18446744073709551615", maxUsdcRaw: "18446744073709551615" };
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateKey = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const partial = `# StockPilot provisioning ${runId}; expiry ${new Date(expiresAt).toISOString()}\n` +
  "# Private authorization key. Never commit or print this file.\n" +
  "PRIVY_EXECUTION_SIGNER_ID=\nPRIVY_EXECUTION_POLICY_ID=\n" +
  `PRIVY_EXECUTION_EXPIRES_AT=${new Date(expiresAt).toISOString()}\nPRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY=${privateKey}\n`;

test("provisioning quorum names satisfy Privy's maximum 50 characters", () => {
  assert.equal(quorumDisplayName(runId), "StockPilot execution 11111111");
  assert.ok(quorumDisplayName(runId).length <= 50);
});

test("resume recovers exact P-256 public key, run and expiry without regenerating keys", () => {
  const config = parseResumeConfiguration(partial, now);
  assert.equal(config.runId, runId);
  assert.equal(config.expiresAt, expiresAt);
  assert.equal(config.privateKey === privateKey, true);
  assert.equal(config.publicKey === publicKey, true);
  for (const invalid of [partial + "UNKNOWN=value\n", partial + "PRIVY_EXECUTION_POLICY_ID=duplicate\n",
    partial.replace("PRIVY_EXECUTION_POLICY_ID=", "PRIVY_EXECUTION_POLICY_ID=policy-without-signer"),
    partial.replace(privateKey, "invalid"), partial.replace(`; expiry ${new Date(expiresAt).toISOString()}`, "; expiry bad")]) {
    assert.throws(() => parseResumeConfiguration(invalid, now));
  }
  assert.throws(() => parseResumeConfiguration(partial, expiresAt), /expiry/);
});

test("resume persists returned signer before policy and reuses original policy idempotency key", async () => {
  const config = parseResumeConfiguration(partial, now);
  const calls: string[] = [];
  await resumeResources({ config, limits, stage: () => {}, save: async (value: typeof config) => {
    calls.push(value.policyId ? "save-policy" : "save-signer");
    assert.equal(value.privateKey === privateKey, true);
  }, privy: {
    keyQuorums: () => ({ create: async (input: { display_name: string; public_keys: string[] }) => {
      calls.push("create-signer"); assert.ok(input.display_name.length <= 50);
      assert.equal(input.public_keys[0] === publicKey, true); return { id: "quorum-resumed" };
    } }),
    policies: () => ({ create: async (input: { idempotency_key: string }) => {
      calls.push("create-policy"); assert.equal(input.idempotency_key, `stockpilot-policy-${runId}`);
      return { id: "policy-resumed" };
    } }),
  } });
  assert.deepEqual(calls, ["create-signer", "save-signer", "create-policy", "save-policy"]);
});

test("resume checks existing signer membership exactly and never retries uncertain creation", async () => {
  for (const override of [{ authorization_threshold: 2 }, { authorization_keys: [{ public_key: "wrong" }] },
    { user_ids: ["other-user"] }, { key_quorum_ids: ["nested"] }, { id: "wrong" }]) {
    const config = { ...parseResumeConfiguration(partial, now), signerId: "quorum-resumed" };
    await assert.rejects(resumeResources({ config, limits, stage: () => {}, save: async () => assert.fail("must not save"), privy: {
      keyQuorums: () => ({ get: async () => ({ id: config.signerId, authorization_threshold: 1,
        authorization_keys: [{ public_key: publicKey }], user_ids: [], key_quorum_ids: [], ...override }) }),
      policies: () => ({ create: async () => assert.fail("must not create policy") }),
    } }), /does not match/);
  }
  let creates = 0;
  await assert.rejects(resumeResources({ config: parseResumeConfiguration(partial, now), limits, stage: () => {},
    save: async () => assert.fail("must not save uncertain result"), privy: {
      keyQuorums: () => ({ create: async () => { creates++; throw new Error("ambiguous timeout"); } }),
      policies: () => ({ create: async () => assert.fail("must not create policy") }),
    } }), /ambiguous timeout/);
  assert.equal(creates, 1);
});

test("provisioning diagnostics include status but never secrets, URLs or unbounded SDK messages", () => {
  const secret = "short-secret";
  const output = provisioningDiagnostic("create_signer", { status: 400, error: { code: "invalid_input",
    message: `Name is too long ${secret} ${privateKey} https://example.test/private?token=unsafe person@example.test` },
    config: { secret }, headers: { authorization: secret } }, [secret, privateKey]);
  assert.match(output, /stage=create_signer status=400 code=invalid_input/);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(privateKey), false);
  assert.equal(output.includes("https://"), false);
  assert.equal(output.includes("person@"), false);
  assert.equal(provisioningDiagnostic("save_signer", new Error(`do not print ${secret}`)), "stage=save_signer status=none code=unclassified");
});
