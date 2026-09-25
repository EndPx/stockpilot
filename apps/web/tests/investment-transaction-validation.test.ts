import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";
import type { PreparedInvestment } from "@stockpilot/core/investments";
import type { PreparedManualSell } from "@stockpilot/core/manual-sell";
import { SOLANA_MAINNET_USDC_MINT, SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import {
  assertPreparedInvestmentTransaction,
  createManualTradeValidationPolicy,
  MANUAL_BUY_FAIL_CLOSED_POLICY,
  parseSupportedJupiterRoute,
  TransactionValidationError,
  verifyCanonicalAssociatedTokenAccountCreation,
  type InstructionEffectProof,
  type PreparedTransactionInspection,
  type PreparedTransactionPolicy,
  type TransactionValidationCode,
} from "../lib/investments/transaction-validation";

// Offline synthetic messages only. The verifier below is a contract fixture, not a
// Jupiter route decoder and never authorizes a production swap.
const wallet = address("PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV");
const otherWallet = address("So11111111111111111111111111111111111111112");
const inputMint = address(SOLANA_MAINNET_USDC_MINT);
const outputMint = address("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh");
const destination = address("Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x");
const attacker = address("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const program = address("11111111111111111111111111111111");
const table = address("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");

function wire(options: {
  feePayer?: Address;
  programAddress?: Address;
  destination?: Address;
  extraSigner?: boolean;
  omitOutputMint?: boolean;
  lookup?: boolean;
} = {}): string {
  const account = options.destination ?? destination;
  const instruction = {
    programAddress: options.programAddress ?? program,
    accounts: [
      { address: inputMint, role: AccountRole.READONLY },
      ...options.omitOutputMint ? [] : [{ address: outputMint, role: AccountRole.READONLY }],
      {
        address: account,
        role: options.extraSigner ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE,
        ...options.lookup ? { lookupTableAddress: table, addressIndex: 0 } : {},
      },
    ],
    data: Uint8Array.of(1, 2, 3),
  } as const;
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(options.feePayer ?? wallet, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 100n }, value),
    (value) => appendTransactionMessageInstruction(instruction, value),
  );
  return Buffer.from(getTransactionEncoder().encode(compileTransaction(message))).toString("base64");
}

function prepared(transaction = wire()): PreparedInvestment {
  return {
    walletAddress: wallet,
    asset: { symbol: "SPACEX", name: "SpaceX PreStocks", mintAddress: outputMint },
    fundingAsset: { symbol: "USDC", mintAddress: inputMint },
    inputAmountRaw: "50000000",
    inputAmountUsd: "50",
    outputAmountRaw: "125000000",
    outputDecimals: 9,
    router: "synthetic-test-only",
    mode: "test",
    feeBps: null,
    feeMint: null,
    priceImpactPct: null,
    transaction,
    requestId: "test-order",
    lastValidBlockHeight: "100",
    expireAt: null,
    createdAt: new Date(0).toISOString(),
  };
}

function proof(overrides: Partial<InstructionEffectProof> = {}): InstructionEffectProof {
  return {
    requestId: "test-order",
    inputMint,
    outputMint,
    maximumInputRaw: "50000000",
    guaranteedMinimumOutputRaw: "123000000",
    maximumNetworkFeeLamports: "10000",
    tokenFees: [],
    otherTokenDebits: [],
    otherNativeDebitLamports: "0",
    coveredInstructionIndexes: [0],
    ...overrides,
  };
}

function policy(overrides: Partial<PreparedTransactionPolicy> = {}): PreparedTransactionPolicy {
  return {
    allowedProgramIds: [program],
    allowedWritableAddresses: [destination],
    minimumOutputRaw: "120000000",
    maximumNetworkFeeLamports: "20000",
    maximumTokenFeesRaw: {},
    getNetworkFeeLamports: async () => "10000",
    verifyInstructionEffects: async () => proof(),
    ...overrides,
  };
}

async function rejects(code: TransactionValidationCode, transaction = prepared(), rules = policy()): Promise<void> {
  await assert.rejects(
    assertPreparedInvestmentTransaction(transaction, rules),
    (error) => error instanceof TransactionValidationError && error.code === code,
  );
}

test("fails closed when a complete instruction verifier is not installed", async () => {
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ verifyInstructionEffects: undefined }));
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), MANUAL_BUY_FAIL_CLOSED_POLICY);
});

test("passes only a fully resolved envelope with matching server-owned proof", async () => {
  const seen = await assertPreparedInvestmentTransaction(prepared(), policy());
  assert.deepEqual(seen.lookupTableAddresses, []);
  assert.deepEqual(seen.writableAddresses, [wallet, destination]);
  assert.deepEqual(seen.instructions.map(({ programAddress }) => programAddress), [program]);
  assert.deepEqual(seen.instructions[0].accounts.map(({ address }) => address), [inputMint, outputMint, destination]);
  assert.deepEqual(seen.effects, {
    maximumInputRaw: "50000000",
    requiredMinimumOutputRaw: "123000000",
    maximumWalletNativeDebitLamportsRaw: "10000",
  });
});

test("rejects invalid wire, changed payer, extra signer, and missing canonical mint", async () => {
  await rejects("INVALID_TRANSACTION", prepared("not base64!"));
  await rejects("INVALID_TRANSACTION", prepared(wire({ feePayer: otherWallet })));
  await rejects("INVALID_TRANSACTION", prepared(wire({ extraSigner: true })));
  await rejects("UNAUTHORIZED_ACCOUNT", prepared(wire({ omitOutputMint: true })));
});

test("rejects arbitrary program and writable recipient even with matching quote fields", async () => {
  await rejects("UNAUTHORIZED_PROGRAM", prepared(wire({ programAddress: attacker })));
  await rejects("UNAUTHORIZED_ACCOUNT", prepared(wire({ destination: attacker })));
});

test("resolves every ALT address before allowing programs or writable accounts", async () => {
  const preparedWithLookup = prepared(wire({ lookup: true }));
  await rejects("UNRESOLVED_LOOKUP_TABLE", preparedWithLookup);
  await rejects("UNRESOLVED_LOOKUP_TABLE", preparedWithLookup, policy({ resolveLookupTable: async () => [] }));
  await rejects("UNAUTHORIZED_ACCOUNT", preparedWithLookup, policy({ resolveLookupTable: async () => [attacker] }));
  const seen = await assertPreparedInvestmentTransaction(preparedWithLookup, policy({ resolveLookupTable: async () => [destination] }));
  assert.deepEqual(seen.lookupTableAddresses, [table]);
  assert.equal(seen.instructions[0].accounts.at(-1)?.address, destination);
});

test("requires proof for every instruction and exact request/mint identity", async () => {
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ verifyInstructionEffects: async () => proof({ coveredInstructionIndexes: [] }) }));
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ verifyInstructionEffects: async () => proof({ requestId: "another-order" }) }));
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ verifyInstructionEffects: async () => proof({ outputMint: attacker }) }));
});

test("requires an independent fee quote for the exact transaction message", async () => {
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ getNetworkFeeLamports: undefined }));
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ getNetworkFeeLamports: async () => "10001" }));
  await rejects("TRANSACTION_SEMANTICS_UNVERIFIED", prepared(), policy({ getNetworkFeeLamports: async () => { throw new Error("RPC unavailable"); } }));
});

test("enforces USDC spend, minimum output, network fee and no other debits", async () => {
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ verifyInstructionEffects: async () => proof({ maximumInputRaw: "50000001" }) }));
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ verifyInstructionEffects: async () => proof({ guaranteedMinimumOutputRaw: "119999999" }) }));
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ getNetworkFeeLamports: async () => "20001", verifyInstructionEffects: async () => proof({ maximumNetworkFeeLamports: "20001" }) }));
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ verifyInstructionEffects: async () => proof({ otherTokenDebits: [{ mint: attacker, raw: "1" }] }) }));
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ verifyInstructionEffects: async () => proof({ otherNativeDebitLamports: "1" }) }));
});

test("only explicitly bounded fee mints and totals are permitted", async () => {
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({ verifyInstructionEffects: async () => proof({ tokenFees: [{ mint: inputMint, raw: "1" }] }) }));
  const withFee = { ...prepared(), feeMint: inputMint };
  await rejects("ECONOMIC_LIMIT_EXCEEDED", withFee, policy({ maximumTokenFeesRaw: { [inputMint]: "10" }, verifyInstructionEffects: async () => proof({ tokenFees: [{ mint: inputMint, raw: "11" }] }) }));
  await rejects("ECONOMIC_LIMIT_EXCEEDED", withFee, policy({ maximumTokenFeesRaw: { [inputMint]: "10" }, verifyInstructionEffects: async () => proof({ tokenFees: [{ mint: inputMint, raw: "10" }] }) }));
  await assert.doesNotReject(assertPreparedInvestmentTransaction(withFee, policy({ maximumTokenFeesRaw: { [inputMint]: "10" }, verifyInstructionEffects: async () => proof({ maximumInputRaw: "49999990", tokenFees: [{ mint: inputMint, raw: "10" }] }) })));
});

const jupiterV6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const computeBudget = "ComputeBudget111111111111111111111111111111";
const associatedToken = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function supportedRouteData(slippage = 100, amountIn = 50_000_000n, quotedOut = 125_000_000n): Uint8Array {
  // Jupiter's original V6 route: discriminator, one Raydium route-plan step,
  // inAmount, quotedOutAmount, slippageBps, zero platformFeeBps.
  const data = new Uint8Array(35);
  data.set(createHash("sha256").update("global:route").digest().subarray(0, 8));
  const view = new DataView(data.buffer);
  view.setUint32(8, 1, true);
  data.set([7, 100, 0, 1], 12);
  view.setBigUint64(16, amountIn, true);
  view.setBigUint64(24, quotedOut, true);
  view.setUint16(32, slippage, true);
  return data;
}

function routeInspection(options: { data?: Uint8Array; authority?: string; extraProgram?: string } = {}): PreparedTransactionInspection {
  const account = (value: string, writable = false, signer = false) => ({ address: value, writable, signer });
  return {
    feePayer: wallet,
    allAddresses: [wallet, inputMint, outputMint, attacker, destination, jupiterV6, SPL_TOKEN_PROGRAM_ADDRESS, computeBudget],
    writableAddresses: [wallet, attacker, destination],
    lookupTableAddresses: [],
    instructions: [
      { programAddress: options.extraProgram ?? computeBudget, accounts: [], data: Uint8Array.of(2, 0x20, 0xa1, 0x07, 0) },
      { programAddress: jupiterV6, accounts: [
        account(SPL_TOKEN_PROGRAM_ADDRESS), account(options.authority ?? wallet, false, true),
        account(attacker, true), account(destination, true), account(jupiterV6),
        account(outputMint), account(jupiterV6), account(inputMint),
      ], data: options.data ?? supportedRouteData() },
    ],
  };
}

function sharedRouteInspection(): PreparedTransactionInspection {
  const data = new Uint8Array(36);
  data.set(createHash("sha256").update("global:shared_accounts_route").digest().subarray(0, 8));
  const view = new DataView(data.buffer);
  data[8] = 0;
  view.setUint32(9, 1, true);
  data.set([7, 100, 0, 1], 13);
  view.setBigUint64(17, 50_000_000n, true);
  view.setBigUint64(25, 125_000_000n, true);
  view.setUint16(33, 75, true);
  const account = (value: string, writable = false, signer = false) => ({ address: value, writable, signer });
  return {
    feePayer: wallet,
    allAddresses: [wallet, inputMint, outputMint, attacker, destination, jupiterV6, SPL_TOKEN_PROGRAM_ADDRESS],
    writableAddresses: [wallet, attacker, destination], lookupTableAddresses: [],
    instructions: [{ programAddress: jupiterV6, accounts: [
      account(SPL_TOKEN_PROGRAM_ADDRESS), account(otherWallet), account(wallet, false, true),
      account(attacker, true), account(otherWallet, true), account(otherWallet, true),
      account(destination, true), account(inputMint), account(outputMint), account(jupiterV6),
    ], data }],
  };
}

test("decodes only a single exact-in Jupiter V6 Raydium route with on-chain output floor", () => {
  const parsed = parseSupportedJupiterRoute(routeInspection(), prepared());
  assert.deepEqual(parsed, {
    swapInstructionIndex: 1,
    ataCreateInstructionIndex: null,
    sourceTokenAccount: attacker,
    destinationTokenAccount: destination,
    maximumInputRaw: "50000000",
    minimumOutputRaw: "123750000",
    variant: "route",
  });
  const rules = createManualTradeValidationPolicy(prepared());
  assert.equal(rules.minimumOutputRaw, "123750000");
  assert.equal(rules.maximumNetworkFeeLamports, "300000");
  assert.equal(typeof rules.resolveLookupTable, "function");
  assert.equal(typeof rules.getNetworkFeeLamports, "function");
});

test("decodes shared-account exact-in route and rejects hidden platform fees", () => {
  const shared = sharedRouteInspection();
  assert.deepEqual(parseSupportedJupiterRoute(shared, prepared()), {
    swapInstructionIndex: 0,
    ataCreateInstructionIndex: null,
    sourceTokenAccount: attacker,
    destinationTokenAccount: destination,
    maximumInputRaw: "50000000",
    minimumOutputRaw: "124062500",
    variant: "shared_accounts_route",
  });
  const feeData = Uint8Array.from(shared.instructions[0].data);
  feeData[35] = 1;
  const changed = { ...shared, instructions: [{ ...shared.instructions[0], data: feeData }] };
  assert.throws(() => parseSupportedJupiterRoute(changed, prepared()), TransactionValidationError);
});

test("rejects unknown Jupiter layout, trailing payload, excess slippage and wrong wallet authority", () => {
  const invalidPayload = new Uint8Array([...supportedRouteData(), 0]);
  const highSlippage = supportedRouteData(101);
  const fakeSwap = supportedRouteData(); fakeSwap[12] = 99;
  for (const inspection of [
    routeInspection({ data: invalidPayload }),
    routeInspection({ data: highSlippage }),
    routeInspection({ data: fakeSwap }),
    routeInspection({ authority: otherWallet }),
    routeInspection({ extraProgram: program }),
  ]) {
    assert.throws(() => parseSupportedJupiterRoute(inspection, prepared()), TransactionValidationError);
  }
});

test("SELL normalizes stock input and canonical USDC output without weakening the route check", () => {
  const seller: PreparedManualSell = {
    assetId: "xstocks-test", provider: "xstocks", principalId: "principal-test", walletAddress: wallet,
    inputMint: outputMint, outputMint: inputMint, inputRaw: "125000000", inputDecimals: 9,
    inputUnits: "RAW_TOKEN_BASE_UNITS", quotedUsdcOutRaw: "50000000",
    requiredMinimumUsdcOutRaw: "49800000", router: "synthetic-test-only", mode: "test",
    feeBps: 0, feeMint: null, priceImpactPct: "0", transaction: wire(), requestId: "sell-test",
    lastValidBlockHeight: "100", expiresAt: new Date(Date.now() + 15_000).toISOString(),
    transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION",
  };
  const inspection = routeInspection({ data: supportedRouteData(25, 125_000_000n, 50_000_000n) });
  const swap = inspection.instructions[1];
  const reversed = { ...inspection, instructions: [inspection.instructions[0], {
    ...swap, accounts: swap.accounts.map((account, index) =>
      index === 5 ? { ...account, address: inputMint } : account),
  }] };
  assert.deepEqual(parseSupportedJupiterRoute(reversed, seller), {
    swapInstructionIndex: 1,
    ataCreateInstructionIndex: null,
    sourceTokenAccount: attacker,
    destinationTokenAccount: destination,
    maximumInputRaw: "125000000",
    minimumOutputRaw: "49875000",
    variant: "route",
  });
  const rules = createManualTradeValidationPolicy(seller);
  assert.equal(rules.minimumOutputRaw, "49800000");
  assert.throws(() => parseSupportedJupiterRoute(routeInspection(), seller), TransactionValidationError);
  assert.throws(() => parseSupportedJupiterRoute(reversed, { ...seller, feeBps: 5, feeMint: inputMint }), TransactionValidationError);
});

test("permits only an exact idempotent ATA creation with wallet payer and canonical derivation", async () => {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(associatedToken),
    seeds: [encoder.encode(wallet), encoder.encode(address(SPL_TOKEN_PROGRAM_ADDRESS)), encoder.encode(outputMint)],
  });
  const account = (value: string, writable = false, signer = false) => ({ address: value, writable, signer });
  const ataInstruction = {
    programAddress: associatedToken,
    accounts: [
      account(wallet, true, true), account(ata, true), account(wallet, true, true),
      account(outputMint), account(program), account(SPL_TOKEN_PROGRAM_ADDRESS),
    ],
    data: Uint8Array.of(1),
  };
  const initial = routeInspection();
  const routed = { ...initial.instructions[1], accounts: initial.instructions[1].accounts.map((item, index) =>
    index === 3 ? { ...item, address: ata } : item) };
  const withAta = { ...initial, instructions: [initial.instructions[0], ataInstruction, routed] };
  assert.equal(parseSupportedJupiterRoute(withAta, prepared()).ataCreateInstructionIndex, 1);
  await assert.doesNotReject(verifyCanonicalAssociatedTokenAccountCreation(ataInstruction, prepared(), ata, SPL_TOKEN_PROGRAM_ADDRESS));
  const [token2022Ata] = await getProgramDerivedAddress({
    programAddress: address(associatedToken),
    seeds: [encoder.encode(wallet), encoder.encode(address(TOKEN_2022_PROGRAM_ADDRESS)), encoder.encode(outputMint)],
  });
  assert.notEqual(token2022Ata, ata);
  const token2022Instruction = { ...ataInstruction, accounts: ataInstruction.accounts.map((item, index) =>
    index === 1 ? { ...item, address: token2022Ata } :
      index === 5 ? { ...item, address: TOKEN_2022_PROGRAM_ADDRESS } : item) };
  await assert.doesNotReject(verifyCanonicalAssociatedTokenAccountCreation(token2022Instruction, prepared(), token2022Ata, TOKEN_2022_PROGRAM_ADDRESS));
  await assert.rejects(verifyCanonicalAssociatedTokenAccountCreation(ataInstruction, prepared(), destination, SPL_TOKEN_PROGRAM_ADDRESS), TransactionValidationError);
  await assert.rejects(verifyCanonicalAssociatedTokenAccountCreation(ataInstruction, prepared(), ata, "TokenzQdBNbLqP5VEhdkAS6EPFocdXWzJp4Ynrrn5s"), TransactionValidationError);
  for (const bad of [
    { ...ataInstruction, data: Uint8Array.of(0) },
    { ...ataInstruction, accounts: ataInstruction.accounts.map((item, index) => index === 0 ? { ...item, address: otherWallet } : item) },
    { ...ataInstruction, accounts: ataInstruction.accounts.map((item, index) => index === 4 ? { ...item, address: attacker } : item) },
  ]) {
    assert.throws(() => parseSupportedJupiterRoute({ ...withAta, instructions: [initial.instructions[0], bad, routed] }, prepared()), TransactionValidationError);
  }
  assert.throws(() => parseSupportedJupiterRoute({ ...withAta,
    instructions: [initial.instructions[0], ataInstruction, ataInstruction, routed] }, prepared()), TransactionValidationError);
});

test("ATA rent and fee are combined into one native wallet debit limit", async () => {
  const seen = await assertPreparedInvestmentTransaction(prepared(), policy({
    maximumAdditionalNativeDebitLamports: "10000000",
    verifyInstructionEffects: async () => proof({ otherNativeDebitLamports: "10000000" }),
  }));
  assert.equal(seen.effects?.maximumWalletNativeDebitLamportsRaw, "10010000");
  await rejects("ECONOMIC_LIMIT_EXCEEDED", prepared(), policy({
    maximumAdditionalNativeDebitLamports: "9999999",
    verifyInstructionEffects: async () => proof({ otherNativeDebitLamports: "10000000" }),
  }));
});
