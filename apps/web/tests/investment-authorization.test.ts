import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  type Blockhash,
} from "@solana/kit";
import {
  assertAuthorizationWallet,
  assertOrderStillValid,
  assertSignedInvestmentTransaction,
  createInvestmentAuthorization,
  fingerprintTransactionMessage,
  InvestmentSecurityError,
  readInvestmentAuthorization,
} from "../lib/investments/authorization";

const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const extraSigner = "So11111111111111111111111111111111111111112";
const outputMint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const inputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const secret = "investment-authorization-test-secret-32-bytes";
const now = 1_700_000_000_000;

function transaction(options: { walletSigned?: boolean; differentMessage?: boolean } = {}): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(address(wallet), value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: (options.differentMessage
        ? "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4nH2e9m5T"
        : "11111111111111111111111111111111") as Blockhash,
      lastValidBlockHeight: 200n,
    }, value),
    (value) => appendTransactionMessageInstruction({
      programAddress: address("11111111111111111111111111111111"),
      accounts: [{ address: address(extraSigner), role: AccountRole.READONLY_SIGNER }],
    }, value),
  );
  const compiled = compileTransaction(message);
  const signed = {
    ...compiled,
    signatures: {
      ...compiled.signatures,
      [wallet]: options.walletSigned ? signatureBytes(new Uint8Array(64).fill(1)) : null,
    },
  };
  return Buffer.from(getTransactionEncoder().encode(signed)).toString("base64");
}

async function token(serialized = transaction(), overrides: Partial<{
  walletAddress: string;
  orderExpireAt: string | null;
  lastValidBlockHeight: string | null;
}> = {}) {
  return createInvestmentAuthorization({
    walletAddress: overrides.walletAddress ?? wallet,
    requestId: "request-one",
    inputMint,
    outputMint,
    inputAmountRaw: "50000000",
    outputDecimals: 9,
    symbol: "SPACEX",
    lastValidBlockHeight: overrides.lastValidBlockHeight ?? "200",
    orderExpireAt: overrides.orderExpireAt ?? null,
    transaction: serialized,
  }, secret, now);
}

test("fingerprints transaction message bytes, not mutable signatures", async () => {
  assert.equal(
    await fingerprintTransactionMessage(transaction()),
    await fingerprintTransactionMessage(transaction({ walletSigned: true })),
  );
});

test("round trips a short-lived authorization bound to every investment field", async () => {
  const decoded = await readInvestmentAuthorization(await token(), secret, now + 1);
  assert.equal(decoded.walletAddress, wallet);
  assert.equal(decoded.requestId, "request-one");
  assert.equal(decoded.inputMint, inputMint);
  assert.equal(decoded.outputMint, outputMint);
  assert.equal(decoded.inputAmountRaw, "50000000");
  assert.equal(decoded.symbol, "SPACEX");
  assert.equal(decoded.expiresAt, now + 120_000);
});

test("rejects modified and expired investment tokens", async () => {
  const encoded = await token();
  await assert.rejects(
    readInvestmentAuthorization(`${encoded.slice(0, -1)}x`, secret, now),
    (error) => error instanceof InvestmentSecurityError && error.code === "INVESTMENT_TOKEN_INVALID",
  );
  await assert.rejects(
    readInvestmentAuthorization(encoded, secret, now + 120_000),
    (error) => error instanceof InvestmentSecurityError && error.code === "INVESTMENT_TOKEN_EXPIRED",
  );
});

test("caps authorization lifetime to an earlier Jupiter RFQ expiry", async () => {
  const expireAt = new Date(now + 30_000).toISOString();
  const decoded = await readInvestmentAuthorization(await token(transaction(), { orderExpireAt: expireAt }), secret, now);
  assert.equal(decoded.expiresAt, now + 30_000);
  await assert.rejects(
    token(transaction(), { orderExpireAt: new Date(now).toISOString() }),
    (error) => error instanceof InvestmentSecurityError && error.code === "JUPITER_ORDER_EXPIRED",
  );
});

test("requires the token wallet to equal the authenticated session wallet", async () => {
  const decoded = await readInvestmentAuthorization(await token(), secret, now);
  assert.doesNotThrow(() => assertAuthorizationWallet(decoded, wallet));
  assert.throws(
    () => assertAuthorizationWallet(decoded, extraSigner),
    (error) => error instanceof InvestmentSecurityError && error.code === "WALLET_MISMATCH",
  );
});

test("accepts the authenticated wallet signature without requiring extra signer slots", async () => {
  const signed = transaction({ walletSigned: true });
  const fingerprint = await fingerprintTransactionMessage(transaction());
  await assert.doesNotReject(assertSignedInvestmentTransaction(signed, wallet, fingerprint));
});

test("rejects missing wallet signature and changed transaction messages", async () => {
  const fingerprint = await fingerprintTransactionMessage(transaction());
  await assert.rejects(
    assertSignedInvestmentTransaction(transaction(), wallet, fingerprint),
    (error) => error instanceof InvestmentSecurityError && error.code === "WALLET_MISMATCH",
  );
  await assert.rejects(
    assertSignedInvestmentTransaction(transaction({ walletSigned: true, differentMessage: true }), wallet, fingerprint),
    (error) => error instanceof InvestmentSecurityError && error.code === "TRANSACTION_MISMATCH",
  );
});

test("checks both block-height and RFQ time validity", async () => {
  const blockBound = await readInvestmentAuthorization(await token(), secret, now);
  assert.doesNotThrow(() => assertOrderStillValid(blockBound, 200n, now));
  assert.throws(
    () => assertOrderStillValid(blockBound, 201n, now),
    (error) => error instanceof InvestmentSecurityError && error.code === "JUPITER_ORDER_EXPIRED",
  );

  const expireAt = new Date(now + 30_000).toISOString();
  const timeBound = await readInvestmentAuthorization(
    await token(transaction(), { orderExpireAt: expireAt, lastValidBlockHeight: null }),
    secret,
    now,
  );
  assert.throws(() => assertOrderStillValid(timeBound, null, now + 30_000), /quote expired/);
});
