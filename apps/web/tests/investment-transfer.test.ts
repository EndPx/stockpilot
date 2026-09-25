import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { address, getAddressDecoder, getAddressEncoder, getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction, getTransactionDecoder, getTransactionEncoder, signatureBytes } from "@solana/kit";
import { SOLANA_MAINNET_USDC_MINT, SPL_TOKEN_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { assertPreparedTransferTransaction, parseTransferAmount, prepareTransfer, reconcileTransferOnChain,
  transferUsdcAta, TransferError, type PreparedTransfer, type TransferRpc } from "../lib/investments/transfer";

// Offline test keys only; RPC fixtures never submit or sign a real transfer.
const keys = generateKeyPairSync("ed25519");
const destinationKeys = generateKeyPairSync("ed25519");
const wallet = getAddressDecoder().decode(keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const recipient = getAddressDecoder().decode(destinationKeys.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const SYSTEM = "11111111111111111111111111111111";
const blockhash = "So11111111111111111111111111111111111111112";
const rent = 2_039_280n;
const fee = 5_000n;
function account(owner: string, data = Buffer.alloc(0), lamports = 100_000_000n) {
  return { owner, data: [data.toString("base64"), "base64"], lamports, executable: false };
}
function token(owner: string, amount: bigint) {
  const data = Buffer.alloc(165);
  data.set(getAddressEncoder().encode(address(SOLANA_MAINNET_USDC_MINT)), 0);
  data.set(getAddressEncoder().encode(address(owner)), 32);
  data.writeBigUInt64LE(amount, 64); data[108] = 1;
  return account(SPL_TOKEN_PROGRAM_ADDRESS, data, rent);
}
function mint() {
  const data = Buffer.alloc(82); data[44] = 6; data[45] = 1;
  return account(SPL_TOKEN_PROGRAM_ADDRESS, data, rent);
}
const response = (value: unknown) => ({ send: async () => value });
const context = (value: unknown) => ({ context: { slot: 123n }, value });
async function fixture(options: { nativeBalance?: bigint; tokenBalance?: bigint; destinationExists?: boolean } = {}) {
  const sourceAta = await transferUsdcAta(wallet);
  const destinationAta = await transferUsdcAta(recipient);
  const accounts = new Map<string, unknown>([
    [wallet, account(SYSTEM, undefined, options.nativeBalance ?? 100_000_000n)], [recipient, account(SYSTEM)],
    [sourceAta, token(wallet, options.tokenBalance ?? 5_000_000n)],
    [destinationAta, options.destinationExists ? token(recipient, 1_000_000n) : null],
    [SOLANA_MAINNET_USDC_MINT, mint()],
  ]);
  let calls = 0;
  const rpc: TransferRpc = {
    getAccountInfo(key) { calls++; return response(context(accounts.get(String(key)) ?? null)); },
    getLatestBlockhash() { calls++; return response(context({ blockhash, lastValidBlockHeight: 500n })); },
    getFeeForMessage() { calls++; return response(context(fee)); },
    getMinimumBalanceForRentExemption() { calls++; return response(rent); },
    getSignatureStatuses() { throw new Error("unexpected status read"); },
    getTransaction() { throw new Error("unexpected transaction read"); },
  };
  return { rpc, accounts, sourceAta, destinationAta, calls: () => calls };
}
function signed(prepared: PreparedTransfer) {
  const transaction = getTransactionDecoder().decode(Buffer.from(prepared.transaction, "base64"));
  const signedTransaction = { ...transaction, signatures: { [wallet]: signatureBytes(sign(null, Uint8Array.from(transaction.messageBytes), keys.privateKey)) } };
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 0) throw new Error("expected v0");
  return { transaction: Buffer.from(getTransactionEncoder().encode(signedTransaction)).toString("base64"),
    signature: getSignatureFromTransaction(signedTransaction),
    message };
}
function chain(prepared: PreparedTransfer, failed = false) {
  const wire = signed(prepared);
  const keys = wire.message.staticAccounts;
  const destination = keys.indexOf(address(prepared.destinationAccount));
  const before: bigint[] = keys.map((_, index) => index === 0 ? 100_000_000n : 1_000_000n);
  const after = [...before];
  const nativePrincipal = prepared.kind === "SOL" && !failed ? BigInt(prepared.inputAmountRaw) : 0n;
  const paidRent = !failed && prepared.createDestinationAta ? rent : 0n;
  if (prepared.createDestinationAta) before[destination] = after[destination] = 0n;
  after[0] -= fee + nativePrincipal + paidRent;
  after[destination] += nativePrincipal + paidRent;
  const balance = (index: number, owner: string, amount: bigint) => ({ accountIndex: index, owner,
    mint: SOLANA_MAINNET_USDC_MINT, programId: SPL_TOKEN_PROGRAM_ADDRESS,
    uiTokenAmount: { amount: amount.toString(), decimals: 6 } });
  const pre: ReturnType<typeof balance>[] = []; const post: ReturnType<typeof balance>[] = [];
  if (prepared.kind === "USDC") {
    const source = keys.indexOf(address(prepared.sourceTokenAccount!));
    pre.push(balance(source, wallet, 5_000_000n));
    post.push(balance(source, wallet, 5_000_000n - (failed ? 0n : BigInt(prepared.inputAmountRaw))));
    if (!prepared.createDestinationAta) pre.push(balance(destination, recipient, 1_000_000n));
    if (!failed || !prepared.createDestinationAta) post.push(balance(destination, recipient,
      (prepared.createDestinationAta ? 0n : 1_000_000n) + (failed ? 0n : BigInt(prepared.inputAmountRaw))));
  }
  const err = failed ? { InstructionError: [0, "Custom"] } : null;
  const tx = { slot: 123n, version: 0, transaction: [wire.transaction, "base64"],
    meta: { err, fee, preBalances: before, postBalances: after, preTokenBalances: pre, postTokenBalances: post,
      loadedAddresses: { writable: [], readonly: [] } } };
  const rpc: TransferRpc = {
    getSignatureStatuses: () => response(context([{ confirmationStatus: "finalized", err, slot: 123n }])),
    getTransaction: () => response(tx),
    getAccountInfo() { throw new Error("read only reconciliation"); },
    getLatestBlockhash() { throw new Error("read only reconciliation"); },
    getFeeForMessage() { throw new Error("read only reconciliation"); },
    getMinimumBalanceForRentExemption() { throw new Error("read only reconciliation"); },
  };
  return { rpc, tx, signature: wire.signature };
}

test("transfer amounts preserve exact decimal u64 and reject unsafe inputs", () => {
  assert.equal(parseTransferAmount("0.000000001", 9), 1n);
  assert.equal(parseTransferAmount("1.234567", 6), 1_234_567n);
  assert.equal(parseTransferAmount("18446744073.709551615", 9), (1n << 64n) - 1n);
  for (const amount of ["0", "-1", "1e2", "01", "1.", "0.0000000001", "18446744073.709551616"]) {
    assert.throws(() => parseTransferAmount(amount, 9), TransferError);
  }
});

test("SOL build binds owner fee payer, exact recipient and principal, fee and no extra accounts", async () => {
  const f = await fixture();
  const prepared = await prepareTransfer({ kind: "SOL", walletAddress: wallet, recipient, amount: "0.001" }, f.rpc);
  assert.equal(prepared.inputAmountRaw, "1000000");
  assert.equal(prepared.maximumNativeDebitLamportsRaw, "1005000");
  assert.equal(prepared.accountRentLamportsRaw, "0");
  const message = signed(prepared).message;
  assert.equal(message.staticAccounts[0], wallet);
  assert.equal(message.instructions.length, 1);
  assert.equal(message.header.numSignerAccounts, 1);
  await assertPreparedTransferTransaction(prepared);
  await assertPreparedTransferTransaction(prepared, signed(prepared).transaction);
});

test("USDC build uses canonical legacy TransferChecked and only exact idempotent recipient ATA creation", async () => {
  for (const destinationExists of [false, true]) {
    const f = await fixture({ destinationExists });
    const prepared = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "1.2" }, f.rpc);
    assert.equal(prepared.mint, SOLANA_MAINNET_USDC_MINT);
    assert.equal(prepared.inputAmountRaw, "1200000");
    assert.equal(prepared.sourceTokenAccount, f.sourceAta);
    assert.equal(prepared.destinationAccount, f.destinationAta);
    assert.equal(prepared.createDestinationAta, !destinationExists);
    assert.equal(prepared.maximumNativeDebitLamportsRaw, (fee + (destinationExists ? 0n : rent)).toString());
    assert.equal(signed(prepared).message.instructions.length, destinationExists ? 1 : 2);
  }
});

test("self, program destinations and insufficient SOL or token balances fail before usable transaction", async () => {
  const f = await fixture();
  for (const target of [wallet, SYSTEM, f.destinationAta, "invalid"]) {
    await assert.rejects(prepareTransfer({ kind: "SOL", walletAddress: wallet, recipient: target, amount: "0.001" }, f.rpc), TransferError);
  }
  for (const [kind, options] of [["SOL", { nativeBalance: 1_000_000n }],
    ["USDC", { nativeBalance: fee + rent - 1n }], ["USDC", { tokenBalance: 999n }]] as const) {
    const poor = await fixture(options);
    await assert.rejects(prepareTransfer({ kind, walletAddress: wallet, recipient, amount: kind === "SOL" ? "0.001" : "0.001" }, poor.rpc),
      (error: unknown) => error instanceof TransferError && error.code === "INSUFFICIENT_BALANCE");
  }
});

test("RPC errors, stale context, null fee, wrong mint and frozen token accounts fail closed", async () => {
  for (const failure of ["rpc", "context", "fee", "mint", "frozen", "owner"] as const) {
    const f = await fixture();
    if (failure === "rpc") f.rpc.getLatestBlockhash = () => ({ send: async () => { throw new Error("secret provider url"); } });
    if (failure === "context") f.rpc.getAccountInfo = () => response({ context: { slot: 122n }, value: account(SYSTEM) });
    if (failure === "fee") f.rpc.getFeeForMessage = () => response(context(null));
    if (failure === "mint") f.accounts.set(SOLANA_MAINNET_USDC_MINT, account(SYSTEM, Buffer.alloc(82)));
    if (failure === "frozen") { const frozen = token(wallet, 10_000_000n); const data = Buffer.from(frozen.data[0], "base64"); data[108] = 2; frozen.data[0] = data.toString("base64"); f.accounts.set(f.sourceAta, frozen); }
    if (failure === "owner") f.accounts.set(f.destinationAta, token(wallet, 0n));
    await assert.rejects(prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.1" }, f.rpc),
      (error: unknown) => error instanceof TransferError && !error.message.includes("secret"), failure);
  }
});

test("independent reconstruction rejects altered economic or recipient commitments and wire bytes", async () => {
  const f = await fixture();
  const prepared = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.1" }, f.rpc);
  for (const edit of [{ inputAmountRaw: "100001" }, { recipient: wallet }, { destinationAccount: wallet },
    { mint: wallet }, { decimals: 9 as const }, { createDestinationAta: false }, { networkFeeLamportsRaw: "0" },
    { maximumNativeDebitLamportsRaw: "9999999" }, { requestId: `build:${"a".repeat(64)}` }, { sourceTokenAccount: recipient }]) {
    await assert.rejects(assertPreparedTransferTransaction({ ...prepared, ...edit }), TransferError);
  }
  const changed = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.2" }, f.rpc);
  await assert.rejects(assertPreparedTransferTransaction(prepared, changed.transaction), TransferError);
  await assert.rejects(assertPreparedTransferTransaction(prepared,
    Buffer.concat([Buffer.from(prepared.transaction, "base64"), Buffer.from([0])]).toString("base64")), TransferError);
});

test("a finalized failed transfer can recover when its source ATA disappeared, but no asset movements are accepted", async () => {
  const f = await fixture();
  const prepared = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.1" }, f.rpc);
  const failed = chain(prepared, true);
  failed.tx.meta.preTokenBalances = [];
  failed.tx.meta.postTokenBalances = [];
  assert.deepEqual(await reconcileTransferOnChain({ prepared, signature: failed.signature }, failed.rpc), { status: "FAILED", slot: 123 });
  failed.tx.meta.postBalances[1] -= 1n;
  await assert.rejects(reconcileTransferOnChain({ prepared, signature: failed.signature }, failed.rpc), TransferError);
});

test("finalized transfers reconcile exact owner debit, recipient credit, fee and ATA rent", async () => {
  for (const kind of ["SOL", "USDC"] as const) {
    const f = await fixture();
    const prepared = await prepareTransfer({ kind, walletAddress: wallet, recipient, amount: "0.001" }, f.rpc);
    const finalized = chain(prepared);
    assert.deepEqual(await reconcileTransferOnChain({ prepared, signature: finalized.signature }, finalized.rpc),
      { status: "CONFIRMED", slot: 123, actualInputAmountRaw: prepared.inputAmountRaw,
        actualOutputAmountRaw: prepared.inputAmountRaw, actualNativeDebitLamportsRaw: prepared.maximumNativeDebitLamportsRaw });
    const failed = chain(prepared, true);
    assert.deepEqual(await reconcileTransferOnChain({ prepared, signature: failed.signature }, failed.rpc), { status: "FAILED", slot: 123 });
  }
});

test("pending or missing finality remains pending without another send", async () => {
  const f = await fixture();
  const prepared = await prepareTransfer({ kind: "SOL", walletAddress: wallet, recipient, amount: "0.001" }, f.rpc);
  const finalized = chain(prepared);
  for (const status of [null, { confirmationStatus: "confirmed", err: null, slot: 123n }]) {
    finalized.rpc.getSignatureStatuses = () => response(context([status]));
    finalized.rpc.getTransaction = () => { throw new Error("must not read before finality"); };
    assert.deepEqual(await reconcileTransferOnChain({ prepared, signature: finalized.signature }, finalized.rpc), { status: "PENDING" });
  }
});

test("recipient shortfall, unrelated debit, wrong token owner and mismatched signed transaction cannot confirm", async () => {
  for (const failure of ["recipient", "owner", "native", "wire"] as const) {
    const f = await fixture({ destinationExists: true });
    const prepared = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.1" }, f.rpc);
    const finalized = chain(prepared);
    const post = finalized.tx.meta.postTokenBalances;
    if (failure === "recipient") post[1].uiTokenAmount.amount = "1099999";
    if (failure === "owner") post[1].owner = wallet;
    if (failure === "native") finalized.tx.meta.postBalances[1] -= 1n;
    if (failure === "wire") {
      const other = await prepareTransfer({ kind: "USDC", walletAddress: wallet, recipient, amount: "0.2" }, f.rpc);
      finalized.tx.transaction[0] = signed(other).transaction;
    }
    await assert.rejects(reconcileTransferOnChain({ prepared, signature: finalized.signature }, finalized.rpc), TransferError, failure);
  }
});
