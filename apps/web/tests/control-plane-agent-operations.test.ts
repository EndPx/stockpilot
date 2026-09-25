import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage,
  getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash } from "@solana/kit";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { listActivity } from "../lib/control-plane/activity";
import type { AgentPrincipal } from "../lib/control-plane/credentials";
import { claimManualBuyExecution, markManualTradeRejected } from "../lib/control-plane/manual-executions";
import { AGENT_TRADE_ASSETS, AgentOperationError, defaultAgentWalletPolicy, getAgentWalletPolicy,
  updateAgentWalletPolicy, reserveAgentOperation, beginAgentOperationSigning, recordAgentOperationSigned,
  beginAgentOperationSubmission, markAgentOperationUnknown, rejectAgentOperationBeforeSigning,
  rejectAgentOperationBeforeSubmission, cancelOwnedAgentOperationReservation,
  reconcileAgentOperation, reconcileOwnedAgentOperation, getAgentOperation, listAgentOperations,
  type AgentOperationIntent, type AgentWalletPolicyInput, type AgentPreparedContext } from "../lib/control-plane/agent-operations";

const sql = (await Promise.all(["0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
  "0003_idempotent_investment_requests.sql", "0004_manual_investment_executions.sql", "0005_agent_wallet_operations.sql"]
  .map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const accountId = "did:privy:agent-operations-test";
const walletAddress = "11111111111111111111111111111111";
const recipient = "So11111111111111111111111111111111111111112";
const clientId = "11111111-2222-3333-4444-555555555555";
const credentialId = "22222222-2222-3333-4444-555555555555";
const identity = { privyUserId: accountId, walletAddress };
const principal: Extract<AgentPrincipal, { authMethod: "oauth" }> = { accountId, walletAddress, clientId, authMethod: "oauth", credentialId: null,
  oauthIssuer: "https://test.authkit.app", oauthSubject: "test-subject", oauthClientId: "test-oauth-client", scopes: ["markets:read"] };
const signature = "3".repeat(88);
const limit = (per = "1000000", daily = "2000000") => ({ perOperationRaw: per, dailyRaw: daily,
  unlimitedPerOperation: false, unlimitedDaily: false });
function policy(): AgentWalletPolicyInput {
  return { automationOptIn: true, expiresAt: null, buyEnabled: true, sellEnabled: true, transferSolEnabled: true,
    transferUsdcEnabled: true, allowedAssetIds: [...AGENT_TRADE_ASSETS], buyLimit: limit(), transferSolLimit: limit(),
    transferUsdcLimit: limit(), sellLimits: AGENT_TRADE_ASSETS.map((assetId) => ({ assetId, limit: limit() })),
    recipientAllowlist: [recipient], anyRecipient: false, eligibility: { countryCode: "ID", nonUsPerson: true, acceptedTerms: true } };
}
function intent(overrides: Partial<AgentOperationIntent> = {}): AgentOperationIntent {
  return { clientRequestId: "agent-intent-00001", kind: "BUY", amountRaw: "1000000", assetId: AGENT_TRADE_ASSETS[0], ...overrides };
}
function prepared(overrides: Partial<AgentPreparedContext> = {}) {
  const compiled = compileTransaction(pipe(createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(address(walletAddress), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: walletAddress as Blockhash, lastValidBlockHeight: 99999n }, message),
    (message) => appendTransactionMessageInstruction({ programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: new Uint8Array([1]) }, message)));
  return { providerRequestId: "prepared-agent-order", messageFingerprint: createHash("sha256").update(Uint8Array.from(compiled.messageBytes)).digest("base64url"),
    preparedContext: { transaction: Buffer.from(getTransactionEncoder().encode(compiled)).toString("base64"),
      expiresAt: new Date(Date.now() + 120_000).toISOString(), lastValidBlockHeight: "99999", maximumWalletNativeDebitLamportsRaw: "2000000",
      inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: AGENT_TRADE_ASSETS[0].split(":")[1], inputDecimals: 6, outputDecimals: 9,
      requiredMinimumOutputRaw: "100", ...overrides } };
}
function code(expected: string) { return (error: unknown) => error instanceof AgentOperationError && error.code === expected; }
async function setup(enabled = true) {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = { query: db.query.bind(db), transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) =>
    db.transaction((tx) => work({ query: tx.query.bind(tx) })) };
  await db.query("INSERT INTO control_accounts(id,primary_wallet_address) VALUES ($1,$2)", [accountId, walletAddress]);
  await db.query("INSERT INTO control_clients(id,account_id,name,client_type) VALUES ($1,$2,'Codex','CODEX')", [clientId, accountId]);
  await db.query("INSERT INTO control_oauth_subject_bindings(issuer,subject,account_id,wallet_address) VALUES ($1,$2,$3,$4)",
    [principal.oauthIssuer, principal.oauthSubject, accountId, walletAddress]);
  await db.query("INSERT INTO control_oauth_connections(client_id,account_id,issuer,subject,oauth_client_id) VALUES ($1,$2,$3,$4,$5)",
    [clientId, accountId, principal.oauthIssuer, principal.oauthSubject, principal.oauthClientId]);
  if (enabled) await updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 0 }, store);
  return { db, store };
}
async function submitted(store: Awaited<ReturnType<typeof setup>>["store"], request = intent()) {
  const reserved = await reserveAgentOperation(principal, request, store);
  const signing = await beginAgentOperationSigning(principal, reserved.operation.id, prepared(), store);
  assert.equal(signing.claimed, true);
  await recordAgentOperationSigned(principal, reserved.operation.id, { transactionSignature: signature }, store);
  assert.equal((await beginAgentOperationSubmission(principal, reserved.operation.id, store)).claimed, true);
  return reserved.operation.id;
}

test("owner policy starts disabled; unlimited, eligibility, assets and version are explicit", async () => {
  const { db, store } = await setup(false);
  try {
    assert.deepEqual(await getAgentWalletPolicy(identity, clientId, store), defaultAgentWalletPolicy());
    await assert.rejects(reserveAgentOperation(principal, intent(), store), code("POLICY_DISABLED"));
    await assert.rejects(updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 0,
      buyLimit: { ...limit(), perOperationRaw: null } }, store), code("INVALID_INPUT"));
    const updated = await updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 0,
      buyLimit: { perOperationRaw: null, dailyRaw: null, unlimitedPerOperation: true, unlimitedDaily: true } }, store);
    assert.equal(updated.version, 1);
    assert.ok(updated.eligibilityAcceptedAt);
    await assert.rejects(updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 0 }, store), code("POLICY_VERSION_MISMATCH"));
    await assert.rejects(getAgentWalletPolicy({ ...identity, walletAddress: recipient }, clientId, store), code("CLIENT_NOT_ALLOWED"));
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 1, eligibility: null }, store);
    await assert.rejects(reserveAgentOperation(principal, intent(), store), code("ELIGIBILITY_REQUIRED"));
  } finally { await db.close(); }
});

test("reservation is atomic, retries are read-only, changed input conflicts and all owner clients share exclusion", async () => {
  const { db, store } = await setup();
  try {
    const attempts = await Promise.all([reserveAgentOperation(principal, intent(), store), reserveAgentOperation(principal, intent(), store)]);
    assert.deepEqual(attempts.map((entry) => entry.created).sort(), [false, true]);
    assert.equal(attempts[0].operation.id, attempts[1].operation.id);
    await assert.rejects(reserveAgentOperation(principal, intent({ amountRaw: "999999" }), store), code("IDEMPOTENCY_CONFLICT"));
    await assert.rejects(reserveAgentOperation(principal, intent({ clientRequestId: "agent-intent-00002" }), store), code("UNRESOLVED_OPERATION"));
    await assert.rejects(db.query("UPDATE control_agent_operations SET amount_raw = 1 WHERE id = $1", [attempts[0].operation.id]));
    await assert.rejects(db.query("DELETE FROM control_agent_operations WHERE id = $1", [attempts[0].operation.id]));
    assert.equal((await listAgentOperations(principal, { limit: 10 }, store)).length, 1);
  } finally { await db.close(); }
});

test("sign/send are single-use and own reservation is excluded from rechecking daily spend", async () => {
  const { db, store } = await setup();
  try {
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), buyLimit: limit("1000000", "1000000"), expectedVersion: 1 }, store);
    const id = (await reserveAgentOperation(principal, intent(), store)).operation.id;
    const context = prepared();
    assert.equal((await beginAgentOperationSigning(principal, id, context, store)).claimed, true);
    assert.equal((await beginAgentOperationSigning(principal, id, context, store)).claimed, false);
    await assert.rejects(beginAgentOperationSigning(principal, id, { ...context, providerRequestId: "replacement" }, store), code("IDEMPOTENCY_CONFLICT"));
    await recordAgentOperationSigned(principal, id, { transactionSignature: signature }, store);
    const sends = await Promise.all([beginAgentOperationSubmission(principal, id, store), beginAgentOperationSubmission(principal, id, store)]);
    assert.deepEqual(sends.map((entry) => entry.claimed).sort(), [false, true]);
    await reconcileAgentOperation(principal, id, { outcome: "CONFIRMED", evidence: "FINALIZED_SUCCESS", actualInputAmountRaw: "1000000" }, store);
    await assert.rejects(reserveAgentOperation(principal, intent({ clientRequestId: "agent-intent-00002", amountRaw: "1" }), store), code("POLICY_LIMIT"));
    const events = await db.query<{ status: string }>("SELECT status FROM control_agent_operation_events WHERE operation_id = $1 ORDER BY created_at", [id]);
    assert.deepEqual(events.rows.map((row) => row.status), ["RESERVED", "SIGNING", "SIGNED", "SUBMITTED", "CONFIRMED"]);
    const activity = (await listActivity(identity, 50, store)).filter((entry) => entry.eventType.startsWith("AGENT_"));
    assert.equal(activity.length, 5);
    assert.ok(activity.some((entry) => entry.eventType === "AGENT_BUY_CONFIRMED"));
    const details = await db.query<{ details: Record<string, unknown> }>("SELECT details FROM control_activity_events WHERE event_type LIKE 'AGENT_%'");
    assert.ok(details.rows.every((entry) => Object.keys(entry.details).sort().join(",") === "kind,operationId"));
  } finally { await db.close(); }
});

test("BUY totals both markets but SELL limits use separate exact raw mint units", async () => {
  const { db, store } = await setup();
  try {
    const id = await submitted(store);
    await reconcileAgentOperation(principal, id, { outcome: "CONFIRMED", evidence: "FINALIZED_SUCCESS", actualInputAmountRaw: "1000000" }, store);
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), buyLimit: limit("2000000", "1500000"), expectedVersion: 1 }, store);
    await assert.rejects(reserveAgentOperation(principal, intent({ assetId: AGENT_TRADE_ASSETS[1], clientRequestId: "other-market-00001" }), store), code("POLICY_LIMIT"));
    const sell = await reserveAgentOperation(principal, intent({ kind: "SELL", clientRequestId: "agent-sell-000001" }), store);
    await rejectAgentOperationBeforeSigning(principal, sell.operation.id, store);
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), sellLimits: [{ assetId: AGENT_TRADE_ASSETS[0], limit: limit("1", "2") }], expectedVersion: 2 }, store);
    await assert.rejects(reserveAgentOperation(principal, intent({ kind: "SELL", clientRequestId: "agent-sell-000002" }), store), code("POLICY_LIMIT"));
    await assert.rejects(reserveAgentOperation(principal, intent({ kind: "SELL", assetId: AGENT_TRADE_ASSETS[1], clientRequestId: "agent-sell-000003" }), store), code("ASSET_NOT_ALLOWED"));
  } finally { await db.close(); }
});

test("transfer recipient restriction is independent and only explicit anyRecipient bypasses it", async () => {
  const { db, store } = await setup();
  try {
    const transfer = { kind: "TRANSFER_SOL" as const, clientRequestId: "agent-sol-transfer1", amountRaw: "500000", recipient: walletAddress };
    await assert.rejects(reserveAgentOperation(principal, transfer, store), code("RECIPIENT_NOT_ALLOWED"));
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), anyRecipient: true, expectedVersion: 1 }, store);
    const allowed = await reserveAgentOperation(principal, transfer, store);
    await rejectAgentOperationBeforeSigning(principal, allowed.operation.id, store);
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), transferUsdcEnabled: false, expectedVersion: 2 }, store);
    await assert.rejects(reserveAgentOperation(principal, { ...transfer, kind: "TRANSFER_USDC", recipient, clientRequestId: "agent-usdc-transfer1" }, store), code("POLICY_DISABLED"));
  } finally { await db.close(); }
});

test("policy edits and OAuth revocation invalidate pre-sign/pre-send permission, owner can reconcile revoked clients", async () => {
  const { db, store } = await setup();
  try {
    const first = (await reserveAgentOperation(principal, intent(), store)).operation;
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 1 }, store);
    await assert.rejects(beginAgentOperationSigning(principal, first.id, prepared(), store), code("POLICY_VERSION_MISMATCH"));
    await rejectAgentOperationBeforeSigning(principal, first.id, store);
    const id = await submitted(store, intent({ clientRequestId: "fresh-intent-00001" }));
    await db.query("UPDATE control_oauth_connections SET revoked_at = now() WHERE client_id = $1", [clientId]);
    await assert.rejects(getAgentOperation(principal, id, store), code("CLIENT_NOT_ALLOWED"));
    await assert.rejects(markAgentOperationUnknown(principal, id, store), code("CLIENT_NOT_ALLOWED"));
    await db.query("UPDATE control_clients SET status = 'REVOKED',revoked_at = now() WHERE id = $1", [clientId]);
    const final = await reconcileOwnedAgentOperation(identity, clientId, id, { outcome: "CONFIRMED", evidence: "FINALIZED_SUCCESS", actualInputAmountRaw: "1000000" }, store);
    assert.equal(final.status, "CONFIRMED");
  } finally { await db.close(); }
});

test("unknown operations never release on timeout; terminal chain evidence is immutable", async () => {
  const { db, store } = await setup();
  try {
    const id = await submitted(store);
    await markAgentOperationUnknown(principal, id, store);
    await assert.rejects(rejectAgentOperationBeforeSigning(principal, id, store), code("INVALID_TRANSITION"));
    await assert.rejects(reconcileAgentOperation(principal, id, { outcome: "REJECTED", evidence: "RPC_PREFLIGHT_REJECTED" }, store), code("INVALID_TRANSITION"));
    await assert.rejects(reserveAgentOperation(principal, intent({ clientRequestId: "replacement-00001" }), store), code("UNRESOLVED_OPERATION"));
    await reconcileAgentOperation(principal, id, { outcome: "FAILED", evidence: "FINALIZED_FAILURE" }, store);
    assert.equal((await reserveAgentOperation(principal, intent(), store)).created, false);
    await assert.rejects(reconcileAgentOperation(principal, id, { outcome: "CONFIRMED", evidence: "FINALIZED_SUCCESS", actualInputAmountRaw: "1" }, store), code("INVALID_TRANSITION"));
    assert.equal((await reserveAgentOperation(principal, intent({ clientRequestId: "new-real-intent-01" }), store)).created, true);
  } finally { await db.close(); }
});

test("positive RPC preflight rejection releases reservations but never permits replay", async () => {
  const { db, store } = await setup();
  try {
    const id = await submitted(store);
    assert.equal((await reconcileAgentOperation(principal, id, { outcome: "REJECTED", evidence: "RPC_PREFLIGHT_REJECTED" }, store)).status, "REJECTED");
    assert.equal((await beginAgentOperationSubmission(principal, id, store)).claimed, false);
    assert.equal((await reserveAgentOperation(principal, intent(), store)).created, false);
    assert.equal((await reserveAgentOperation(principal, intent({ clientRequestId: "after-preflight01" }), store)).created, true);
  } finally { await db.close(); }
});

test("manual and agent exclusion is enforced in both directions by shared owner locks", async () => {
  const { db, store } = await setup();
  try {
    const manual = { accountId, walletAddress, providerRequestId: "manual-exclusion-order", messageFingerprint: "a".repeat(43),
      transactionSignature: "5".repeat(88), inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: recipient, outputDecimals: 9,
      inputAmountRaw: "100", requiredMinimumOutputRaw: "1", maximumWalletNativeDebitLamportsRaw: "10000",
      expiresAt: new Date(Date.now() + 120_000).toISOString() };
    await claimManualBuyExecution(manual, store);
    await assert.rejects(reserveAgentOperation(principal, intent(), store), code("UNRESOLVED_OPERATION"));
    await markManualTradeRejected(manual, store);
    await reserveAgentOperation(principal, intent(), store);
    await assert.rejects(claimManualBuyExecution({ ...manual, providerRequestId: "new-manual-order", transactionSignature: "6".repeat(88) }, store));
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM control_manual_investment_executions")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("credential authentication is also live and recovered context never accepts signed wire or secret fields", async () => {
  const { db, store } = await setup();
  try {
    await db.query("INSERT INTO control_credentials(id,client_id,display_prefix,secret_hash,expires_at) VALUES ($1,$2,'test-key-prefix',$3,now()+interval '1 day')",
      [credentialId, clientId, new Uint8Array(32)]);
    const keyed: AgentPrincipal = { accountId, walletAddress, clientId, scopes: [], authMethod: "api_key", credentialId };
    const id = (await reserveAgentOperation(keyed, intent(), store)).operation.id;
    const context = prepared();
    await assert.rejects(beginAgentOperationSigning(keyed, id, { ...context, preparedContext: { ...context.preparedContext, privateKey: "never-store" } as AgentPreparedContext }, store), code("INVALID_INPUT"));
    const bytes = Buffer.from(context.preparedContext.transaction, "base64");
    bytes[1] = 1;
    await assert.rejects(beginAgentOperationSigning(keyed, id, { ...context, preparedContext: { ...context.preparedContext, transaction: bytes.toString("base64") } }, store), code("INVALID_INPUT"));
    await db.query("UPDATE control_credentials SET revoked_at = now() WHERE id = $1", [credentialId]);
    await assert.rejects(beginAgentOperationSigning(keyed, id, context, store), code("CLIENT_NOT_ALLOWED"));
  } finally { await db.close(); }
});

test("expiry and policy changes between signing and sending are checked again", async () => {
  const { db, store } = await setup();
  try {
    const id = (await reserveAgentOperation(principal, intent(), store)).operation.id;
    await beginAgentOperationSigning(principal, id, prepared(), store);
    await recordAgentOperationSigned(principal, id, { transactionSignature: signature }, store);
    await db.query("UPDATE control_agent_wallet_policies SET policy = jsonb_set(policy,'{expiresAt}',to_jsonb((now()-interval '1 day')::text)) WHERE client_id = $1", [clientId]);
    await assert.rejects(beginAgentOperationSubmission(principal, id, store), code("POLICY_EXPIRED"));
    assert.equal((await getAgentOperation(principal, id, store)).status, "SIGNED");
    await updateAgentWalletPolicy(identity, clientId, { ...policy(), expectedVersion: 1 }, store);
    await assert.rejects(beginAgentOperationSubmission(principal, id, store), code("POLICY_VERSION_MISMATCH"));
    await db.query("UPDATE control_clients SET expires_at = now() - interval '1 day' WHERE id = $1", [clientId]);
    await assert.rejects(beginAgentOperationSubmission(principal, id, store), code("CLIENT_NOT_ALLOWED"));
  } finally { await db.close(); }
});

test("SOL and USDC persist strict unsigned transfer recovery metadata through final settlement", async () => {
  const { db, store } = await setup();
  try {
    for (const [index, kind] of (["TRANSFER_SOL", "TRANSFER_USDC"] as const).entries()) {
      const request = { kind, clientRequestId: `transfer-fixture-000${index}`, amountRaw: "100000", recipient };
      const id = (await reserveAgentOperation(principal, request, store)).operation.id;
      const context = prepared({ transfer: { kind: kind === "TRANSFER_SOL" ? "SOL" : "USDC", blockhash: walletAddress,
        mint: kind === "TRANSFER_SOL" ? null : SOLANA_MAINNET_USDC_MINT, decimals: kind === "TRANSFER_SOL" ? 9 : 6,
        networkFeeLamportsRaw: "5000", accountRentLamportsRaw: "0", sourceTokenAccount: kind === "TRANSFER_SOL" ? null : walletAddress,
        destinationAccount: recipient, createDestinationAta: false } });
      context.providerRequestId += index;
      await beginAgentOperationSigning(principal, id, context, store);
      const persisted = (await getAgentOperation(principal, id, store)).preparedContext!;
      assert.equal(persisted.transfer?.kind, kind === "TRANSFER_SOL" ? "SOL" : "USDC");
      await assert.rejects(db.query("UPDATE control_agent_operations SET prepared_context = '{}' WHERE id = $1", [id]));
      await recordAgentOperationSigned(principal, id, { transactionSignature: String(index + 4).repeat(88) }, store);
      await beginAgentOperationSubmission(principal, id, store);
      assert.equal((await reconcileAgentOperation(principal, id, { outcome: "CONFIRMED", evidence: "FINALIZED_SUCCESS", actualInputAmountRaw: request.amountRaw }, store)).status, "CONFIRMED");
    }
  } finally { await db.close(); }
});

test("the same wallet is excluded across accounts, not only within one owner row", async () => {
  const { db, store } = await setup();
  try {
    await reserveAgentOperation(principal, intent(), store);
    const otherAccount = "did:privy:another-owner";
    await db.query("INSERT INTO control_accounts(id,primary_wallet_address) VALUES ($1,$2)", [otherAccount, walletAddress]);
    await assert.rejects(claimManualBuyExecution({ accountId: otherAccount, walletAddress,
      providerRequestId: "same-wallet-other-owner", messageFingerprint: "b".repeat(43), transactionSignature: "8".repeat(88),
      inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: recipient, outputDecimals: 9, inputAmountRaw: "100",
      requiredMinimumOutputRaw: "1", maximumWalletNativeDebitLamportsRaw: "10000", expiresAt: new Date(Date.now() + 60_000).toISOString() }, store));
  } finally { await db.close(); }
});

test("provably unsent SIGNED and untouched RESERVED can release after revocation but ambiguous states cannot", async () => {
  const { db, store } = await setup();
  try {
    const id = (await reserveAgentOperation(principal, intent(), store)).operation.id;
    await beginAgentOperationSigning(principal, id, prepared(), store);
    await recordAgentOperationSigned(principal, id, { transactionSignature: signature }, store);
    await db.query("UPDATE control_clients SET status='REVOKED',revoked_at=now() WHERE id=$1", [clientId]);
    await assert.rejects(beginAgentOperationSubmission(principal, id, store), code("CLIENT_NOT_ALLOWED"));
    const released = await rejectAgentOperationBeforeSubmission(principal, id, store);
    assert.equal(released.status, "REJECTED");
    assert.equal(released.submittedAt, null);
    assert.equal(released.transactionSignature, signature);
    await db.query("UPDATE control_clients SET status='ACTIVE',revoked_at=NULL WHERE id=$1", [clientId]);
    const untouched = (await reserveAgentOperation(principal, intent({ clientRequestId: "untouched-intent01" }), store)).operation.id;
    await db.query("UPDATE control_clients SET status='REVOKED',revoked_at=now() WHERE id=$1", [clientId]);
    assert.equal((await cancelOwnedAgentOperationReservation(identity, clientId, untouched, store)).status, "REJECTED");
    await assert.rejects(cancelOwnedAgentOperationReservation({ ...identity, walletAddress: recipient }, clientId, untouched, store), code("CLIENT_NOT_ALLOWED"));
    await db.query("UPDATE control_clients SET status='ACTIVE',revoked_at=NULL WHERE id=$1", [clientId]);
    const uncertain = (await reserveAgentOperation(principal, intent({ clientRequestId: "uncertain-intent01" }), store)).operation.id;
    await beginAgentOperationSigning(principal, uncertain, { ...prepared(), providerRequestId: "other-provider-order" }, store);
    await markAgentOperationUnknown(principal, uncertain, store);
    await assert.rejects(cancelOwnedAgentOperationReservation(identity, clientId, uncertain, store), code("INVALID_TRANSITION"));
    await assert.rejects(rejectAgentOperationBeforeSubmission(principal, uncertain, store), code("INVALID_TRANSITION"));
  } finally { await db.close(); }
});

test("documented runtime grants permit row locking and events without deleting operations or mutating wallet locks", async () => {
  const { db, store } = await setup();
  try {
    await db.exec(`CREATE ROLE stockpilot_app;
      GRANT USAGE ON SCHEMA public TO stockpilot_app;
      GRANT SELECT,INSERT,UPDATE ON control_accounts,control_clients,control_credentials,control_oauth_connections,
        control_manual_investment_executions TO stockpilot_app;
      GRANT SELECT,INSERT ON control_activity_events TO stockpilot_app;`);
    await db.exec(await readFile(new URL("../../../deploy/grant-runtime-agent-operations.sql", import.meta.url), "utf8"));
    await db.exec("SET ROLE stockpilot_app");
    const operation = (await reserveAgentOperation(principal, intent(), store)).operation;
    assert.equal((await rejectAgentOperationBeforeSigning(principal, operation.id, store)).status, "REJECTED");
    await assert.rejects(db.query("DELETE FROM control_agent_operations WHERE id=$1", [operation.id]));
    await assert.rejects(db.query("UPDATE control_wallet_operation_locks SET wallet_address=$2 WHERE wallet_address=$1", [walletAddress, recipient]));
    await assert.rejects(db.query("DELETE FROM control_wallet_operation_locks WHERE wallet_address=$1", [walletAddress]));
  } finally { await db.close(); }
});
