import { isAddress } from "@solana/kit";
import { assertAssetIdentity, type AssetProvider, type InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import type { JupiterExecutionAdapter, JupiterOrder } from "@stockpilot/integrations/jupiter-v2";
import type { MintInspection } from "@stockpilot/integrations/market-validation";
import { readProviderJson } from "@stockpilot/integrations/provider-json";
import type { InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import { formatRawTokenAmount, type SolanaReadAdapter } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT, SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { effectiveMultiplier, parseRawU64 } from "@stockpilot/core/token-amounts";

const MAX_TRANSACTION_BYTES = 1_232;
const MAX_CATALOG_AGE_MS = 300_000;
const MAX_REVIEW_AGE_MS = 86_400_000;
const MAX_CLOCK_SKEW_MS = 5_000;
const CORPORATE_ACTION_WINDOW_MS = 15 * 60_000;
const SAFE_EXTENSIONS = new Set(["metadataPointer", "tokenMetadata", "scaledUiAmountConfig", "defaultAccountState", "pausableConfig"]);

export type ManualSellErrorCode =
  | "INVALID_INPUT" | "CATALOG_UNAVAILABLE" | "ASSET_NOT_ALLOWED"
  | "PRODUCT_REVIEW_REQUIRED" | "INVESTOR_REVIEW_REQUIRED"
  | "TECHNICAL_REVIEW_REQUIRED" | "OWNER_ACCOUNT_REVIEW_REQUIRED"
  | "INSUFFICIENT_ASSET_BALANCE" | "QUOTE_UNAVAILABLE"
  | "ORDER_UNAVAILABLE" | "ORDER_OUT_OF_POLICY" | "UNSIGNED_ENVELOPE_UNVERIFIED";

export class ManualSellError extends Error {
  constructor(readonly code: ManualSellErrorCode) { super(code); this.name = "ManualSellError"; }
}

export type SellPrincipal = Readonly<{ principalId: string; walletAddress: string }>;
export type SellPolicy = Readonly<{
  maxFeeBps: number; maxPriceImpactBps: number; maxSlippageBps: number;
  maxOrderLifetimeMs: number; maxQuoteAgeMs: number;
}>;
export type ProductSellReview = Readonly<{
  operation: "SELL"; assetId: string; mintAddress: string; provider: AssetProvider;
  allowed: boolean; restrictionsComplete: boolean; tokenCompatibilityReviewed: boolean;
  evidenceId: string; reviewedAt: string; expiresAt: string;
}>;
export type InvestorSellReview = Readonly<{
  operation: "SELL"; principalId: string; walletAddress: string;
  assetId: string; mintAddress: string; allowed: boolean; restrictionsComplete: boolean;
  evidenceId: string; reviewedAt: string; expiresAt: string;
}>;
/** Owner-token-account restrictions cannot be inferred from the mint or aggregate balance. */
export type OwnerTokenSellReview = Readonly<{
  operation: "SELL"; walletAddress: string; mintAddress: string;
  tokenProgram: string; decimals: number; availableRaw: string;
  allAccountsTransferable: boolean; evidenceId: string; validatedAt: string; expiresAt: string;
}>;
/** Independent, read-only reverse quote. A BUY-side diagnostic quote is insufficient. */
export type ReverseSellQuote = Readonly<{
  inputMint: string; outputMint: string; inputRaw: string; outputRaw: string;
  venues: readonly string[]; priceImpactPct: string;
  quotedAt: string; expiresAt: string;
}>;

/** Fixed-origin, read-only Jupiter reverse quote; never returns or requests a transaction. */
export async function fetchJupiterReverseSellQuote(
  input: { inputMint: string; outputMint: typeof SOLANA_MAINNET_USDC_MINT; amountRaw: string; slippageBps: number },
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ReverseSellQuote> {
  if (!isAddress(input.inputMint) || input.outputMint !== SOLANA_MAINNET_USDC_MINT ||
      u64(input.amountRaw, "INVALID_INPUT") === 0n || !Number.isInteger(input.slippageBps) ||
      input.slippageBps < 0 || input.slippageBps > 500) fail("INVALID_INPUT");
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.search = new URLSearchParams({ inputMint: input.inputMint, outputMint: SOLANA_MAINNET_USDC_MINT,
    amount: input.amountRaw, slippageBps: String(input.slippageBps), swapMode: "ExactIn" }).toString();
  let response: Response;
  let payload: unknown;
  try {
    const key = process.env.JUPITER_API_KEY;
    response = await fetcher(url, { headers: { Accept: "application/json", ...(key ? { "x-api-key": key } : {}) },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    payload = await readProviderJson(response, 64_000);
  } catch { return fail("QUOTE_UNAVAILABLE"); }
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) fail("QUOTE_UNAVAILABLE");
  const row = payload as Record<string, unknown>;
  if (row.inputMint !== input.inputMint || row.outputMint !== SOLANA_MAINNET_USDC_MINT ||
      row.inAmount !== input.amountRaw || row.swapMode !== "ExactIn" ||
      typeof row.outAmount !== "string" || u64(row.outAmount, "QUOTE_UNAVAILABLE") === 0n ||
      typeof row.priceImpactPct !== "string" || !Array.isArray(row.routePlan) || !row.routePlan.length ||
      row.routePlan.length > 20) fail("QUOTE_UNAVAILABLE");
  const venues = row.routePlan.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("QUOTE_UNAVAILABLE");
    const swap = (entry as Record<string, unknown>).swapInfo;
    if (!swap || typeof swap !== "object" || Array.isArray(swap)) fail("QUOTE_UNAVAILABLE");
    const label = (swap as Record<string, unknown>).label;
    if (typeof label !== "string" || !label || label.length > 100) fail("QUOTE_UNAVAILABLE");
    return label;
  });
  try { percentBpsCeiling(row.priceImpactPct); } catch { return fail("QUOTE_UNAVAILABLE"); }
  const receivedAt = now();
  return { inputMint: input.inputMint, outputMint: SOLANA_MAINNET_USDC_MINT,
    inputRaw: input.amountRaw, outputRaw: row.outAmount, venues, priceImpactPct: row.priceImpactPct,
    quotedAt: new Date(receivedAt).toISOString(), expiresAt: new Date(receivedAt + 15_000).toISOString() };
}
export type PreparedManualSell = Readonly<{
  assetId: string; provider: AssetProvider; principalId: string; walletAddress: string;
  inputMint: string; outputMint: typeof SOLANA_MAINNET_USDC_MINT;
  inputRaw: string; inputDecimals: number; inputUnits: "RAW_TOKEN_BASE_UNITS";
  quotedUsdcOutRaw: string; requiredMinimumUsdcOutRaw: string;
  router: string; mode: string; feeBps: number; feeMint: string | null;
  priceImpactPct: string; transaction: string; requestId: string;
  lastValidBlockHeight: string; expiresAt: string;
  /** This preparer never signs or submits. A separate instruction-effect verifier must still reject by default. */
  transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION";
}>;

type Dependencies = Readonly<{
  principal: SellPrincipal;
  registry: Pick<InvestmentAssetRegistry, "getSnapshot">;
  inspectMint: (mint: string) => Promise<MintInspection>;
  balances: Pick<SolanaReadAdapter, "getTokenBalances">;
  reverseQuote: (input: { inputMint: string; outputMint: typeof SOLANA_MAINNET_USDC_MINT; amountRaw: string; slippageBps: number }) => Promise<ReverseSellQuote>;
  jupiter: Pick<JupiterExecutionAdapter, "createOrder">;
  reviewProduct: (asset: InvestmentAsset, mint: MintInspection) => Promise<ProductSellReview | null>;
  reviewInvestor: (principal: SellPrincipal, asset: InvestmentAsset) => Promise<InvestorSellReview | null>;
  reviewOwnerAccounts: (walletAddress: string, asset: InvestmentAsset) => Promise<OwnerTokenSellReview | null>;
  /** Trusted server adapter must prove there are no existing signatures before exposing transaction bytes. */
  verifyUnsignedEnvelope: (transaction: string, walletAddress: string) => Promise<boolean>;
  policy: SellPolicy;
  now?: () => number;
}>;

function fail(code: ManualSellErrorCode): never { throw new ManualSellError(code); }
function u64(value: string, code: ManualSellErrorCode): bigint {
  try { return parseRawU64(value); } catch { return fail(code); }
}
function boundedTime(value: string, now: number, maxAgeMs: number, code: ManualSellErrorCode): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now + MAX_CLOCK_SKEW_MS || now - parsed > maxAgeMs) fail(code);
  return parsed;
}
function expiry(value: string, now: number, maxFutureMs: number, code: ManualSellErrorCode): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= now || parsed > now + maxFutureMs) fail(code);
  return parsed;
}
function reviewEvidence(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 200; }
function percentBpsCeiling(value: string): bigint {
  if (typeof value !== "string" || value.length > 24) fail("ORDER_OUT_OF_POLICY");
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) fail("ORDER_OUT_OF_POLICY");
  const scaled = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return (scaled * 100n + 999_999n) / 1_000_000n;
}
function canonicalBase64(value: string): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length > 0 && bytes.length <= MAX_TRANSACTION_BYTES && bytes.toString("base64") === value;
}

/** A read-only, fail-closed SELL order preparer. It grants no agent or wallet signing authority. */
export class ManualSellService {
  private readonly now: () => number;
  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
    const p = deps.policy;
    if (!deps.principal.principalId || deps.principal.principalId.length > 200 ||
        !isAddress(deps.principal.walletAddress) ||
        !Number.isInteger(p.maxFeeBps) || p.maxFeeBps < 0 || p.maxFeeBps > 1_000 ||
        !Number.isInteger(p.maxPriceImpactBps) || p.maxPriceImpactBps < 0 || p.maxPriceImpactBps > 1_000 ||
        !Number.isInteger(p.maxSlippageBps) || p.maxSlippageBps < 0 || p.maxSlippageBps > 500 ||
        !Number.isInteger(p.maxOrderLifetimeMs) || p.maxOrderLifetimeMs < 1 || p.maxOrderLifetimeMs > 120_000 ||
        !Number.isInteger(p.maxQuoteAgeMs) || p.maxQuoteAgeMs < 1 || p.maxQuoteAgeMs > 30_000) {
      throw new Error("Invalid server-bound SELL principal or policy.");
    }
  }

  async prepare(input: { assetId: string; amountRaw: string; minimumUsdcOutRaw: string }): Promise<PreparedManualSell> {
    if (!/^(prestocks|xstocks):[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.assetId)) fail("INVALID_INPUT");
    const amount = u64(input.amountRaw, "INVALID_INPUT");
    const userFloor = u64(input.minimumUsdcOutRaw, "INVALID_INPUT");
    if (!amount || !userFloor) fail("INVALID_INPUT");
    const provider = input.assetId.startsWith("xstocks:") ? "xstocks" : "prestocks";
    const now = this.now();
    let snapshot: Awaited<ReturnType<Dependencies["registry"]["getSnapshot"]>>;
    try { snapshot = await this.deps.registry.getSnapshot(provider); }
    catch { return fail("CATALOG_UNAVAILABLE"); }
    const source = snapshot.sources.find((row) => row.provider === provider);
    if (snapshot.stale || !source || source.stale) fail("CATALOG_UNAVAILABLE");
    const catalogTime = boundedTime(source.fetchedAt, now, MAX_CATALOG_AGE_MS, "CATALOG_UNAVAILABLE");
    const asset = snapshot.assets.find((row) => row.id === input.assetId);
    if (!asset) fail("ASSET_NOT_ALLOWED");
    try { assertAssetIdentity(asset); } catch { return fail("ASSET_NOT_ALLOWED"); }
    if (asset.provider !== provider || asset.id !== `${provider}:${asset.mintAddress}` ||
        provider === "xstocks" && (!["PUBLIC_EQUITY", "ETF"].includes(asset.marketType) ||
          asset.metadata?.isTradingHalted !== false || !asset.metadata.classificationSource)) fail("ASSET_NOT_ALLOWED");
    if (provider === "xstocks" && (asset.availability?.status !== "AVAILABLE" ||
        !asset.availability.restrictionsComplete || !asset.availability.reviewedAt ||
        !asset.availability.issuerTermsUrl?.startsWith("https://"))) fail("PRODUCT_REVIEW_REQUIRED");

    let mint: MintInspection;
    try { mint = await this.deps.inspectMint(asset.mintAddress); }
    catch { return fail("TECHNICAL_REVIEW_REQUIRED"); }
    this.checkMint(asset, mint);

    let product: ProductSellReview | null;
    try { product = await this.deps.reviewProduct(asset, mint); }
    catch { return fail("PRODUCT_REVIEW_REQUIRED"); }
    if (!product || product.operation !== "SELL" || product.assetId !== asset.id || product.mintAddress !== asset.mintAddress ||
        product.provider !== provider || !product.allowed || !product.restrictionsComplete || !product.tokenCompatibilityReviewed ||
        !reviewEvidence(product.evidenceId)) fail("PRODUCT_REVIEW_REQUIRED");
    const productTime = boundedTime(product.reviewedAt, this.now(), MAX_REVIEW_AGE_MS, "PRODUCT_REVIEW_REQUIRED");
    const productExpiry = expiry(product.expiresAt, this.now(), MAX_REVIEW_AGE_MS, "PRODUCT_REVIEW_REQUIRED");
    let investor: InvestorSellReview | null;
    try { investor = await this.deps.reviewInvestor(this.deps.principal, asset); }
    catch { return fail("INVESTOR_REVIEW_REQUIRED"); }
    if (!investor || investor.operation !== "SELL" || investor.principalId !== this.deps.principal.principalId ||
        investor.walletAddress !== this.deps.principal.walletAddress || investor.assetId !== asset.id ||
        investor.mintAddress !== asset.mintAddress || !investor.allowed || !investor.restrictionsComplete ||
        !reviewEvidence(investor.evidenceId)) fail("INVESTOR_REVIEW_REQUIRED");
    boundedTime(investor.reviewedAt, this.now(), MAX_REVIEW_AGE_MS, "INVESTOR_REVIEW_REQUIRED");
    const investorExpiry = expiry(investor.expiresAt, this.now(), MAX_REVIEW_AGE_MS, "INVESTOR_REVIEW_REQUIRED");

    let tokenAccounts: Awaited<ReturnType<Dependencies["balances"]["getTokenBalances"]>>;
    let owner: OwnerTokenSellReview | null;
    try { [tokenAccounts, owner] = await Promise.all([
      this.deps.balances.getTokenBalances(this.deps.principal.walletAddress),
      this.deps.reviewOwnerAccounts(this.deps.principal.walletAddress, asset),
    ]); } catch { return fail("OWNER_ACCOUNT_REVIEW_REQUIRED"); }
    const program = mint.program === TOKEN_2022_PROGRAM_ADDRESS ? "token-2022" : "spl-token";
    let available = 0n;
    for (const account of tokenAccounts.filter((row) => row.mintAddress === asset.mintAddress)) {
      if (account.program !== program || account.decimals !== mint.decimals ||
          account.amount !== formatRawTokenAmount(account.rawAmount, account.decimals)) fail("OWNER_ACCOUNT_REVIEW_REQUIRED");
      available += u64(account.rawAmount, "OWNER_ACCOUNT_REVIEW_REQUIRED");
    }
    if (!owner || owner.operation !== "SELL" || owner.walletAddress !== this.deps.principal.walletAddress ||
        owner.mintAddress !== asset.mintAddress || owner.tokenProgram !== mint.program || owner.decimals !== mint.decimals ||
        !owner.allAccountsTransferable || !reviewEvidence(owner.evidenceId) ||
        u64(owner.availableRaw, "OWNER_ACCOUNT_REVIEW_REQUIRED") !== available) fail("OWNER_ACCOUNT_REVIEW_REQUIRED");
    boundedTime(owner.validatedAt, this.now(), 30_000, "OWNER_ACCOUNT_REVIEW_REQUIRED");
    const ownerExpiry = expiry(owner.expiresAt, this.now(), 30_000, "OWNER_ACCOUNT_REVIEW_REQUIRED");
    if (available < amount) fail("INSUFFICIENT_ASSET_BALANCE");

    let quote: ReverseSellQuote;
    try { quote = await this.deps.reverseQuote({ inputMint: asset.mintAddress,
      outputMint: SOLANA_MAINNET_USDC_MINT, amountRaw: amount.toString(), slippageBps: this.deps.policy.maxSlippageBps }); }
    catch { return fail("QUOTE_UNAVAILABLE"); }
    if (quote.inputMint !== asset.mintAddress || quote.outputMint !== SOLANA_MAINNET_USDC_MINT ||
        quote.inputRaw !== amount.toString() || !Array.isArray(quote.venues) || !quote.venues.length ||
        quote.venues.some((venue) => typeof venue !== "string" || !venue || venue.length > 100)) fail("QUOTE_UNAVAILABLE");
    const quoteOut = u64(quote.outputRaw, "QUOTE_UNAVAILABLE");
    if (!quoteOut) fail("QUOTE_UNAVAILABLE");
    const quotedAt = boundedTime(quote.quotedAt, this.now(), this.deps.policy.maxQuoteAgeMs, "QUOTE_UNAVAILABLE");
    const quoteExpiry = expiry(quote.expiresAt, this.now(), this.deps.policy.maxQuoteAgeMs, "QUOTE_UNAVAILABLE");
    if (quoteExpiry <= quotedAt || percentBpsCeiling(quote.priceImpactPct) > BigInt(this.deps.policy.maxPriceImpactBps)) fail("ORDER_OUT_OF_POLICY");

    let order: JupiterOrder;
    try { order = await this.deps.jupiter.createOrder({ inputMint: asset.mintAddress,
      outputMint: SOLANA_MAINNET_USDC_MINT, amountRaw: amount.toString(), taker: this.deps.principal.walletAddress }); }
    catch { return fail("ORDER_UNAVAILABLE"); }
    const orderOut = this.checkOrder(order, asset.mintAddress, amount.toString());
    const quoteFloor = quoteOut * BigInt(10_000 - this.deps.policy.maxSlippageBps) / 10_000n;
    const orderFloor = orderOut * BigInt(10_000 - this.deps.policy.maxSlippageBps) / 10_000n;
    const minimum = [userFloor, quoteFloor, orderFloor].reduce((high, value) => value > high ? value : high);
    if (!minimum || minimum > orderOut) fail("ORDER_OUT_OF_POLICY");
    let unsigned: boolean;
    try { unsigned = await this.deps.verifyUnsignedEnvelope(order.transaction, this.deps.principal.walletAddress); }
    catch { return fail("UNSIGNED_ENVELOPE_UNVERIFIED"); }
    if (!unsigned) fail("UNSIGNED_ENVELOPE_UNVERIFIED");
    const orderExpiry = expiry(order.expireAt!, this.now(), this.deps.policy.maxOrderLifetimeMs, "ORDER_UNAVAILABLE");
    const expiresAt = Math.min(orderExpiry, quoteExpiry, ownerExpiry, investorExpiry, productExpiry,
      productTime + MAX_REVIEW_AGE_MS, catalogTime + MAX_CATALOG_AGE_MS, this.now() + this.deps.policy.maxOrderLifetimeMs);
    if (expiresAt <= this.now()) fail("ORDER_UNAVAILABLE");
    return {
      assetId: asset.id, provider, principalId: this.deps.principal.principalId,
      walletAddress: this.deps.principal.walletAddress, inputMint: asset.mintAddress,
      outputMint: SOLANA_MAINNET_USDC_MINT, inputRaw: amount.toString(), inputDecimals: mint.decimals,
      inputUnits: "RAW_TOKEN_BASE_UNITS", quotedUsdcOutRaw: orderOut.toString(),
      requiredMinimumUsdcOutRaw: minimum.toString(), router: order.router, mode: order.mode,
      feeBps: order.feeBps!, feeMint: order.feeMint, priceImpactPct: order.priceImpactPct!,
      transaction: order.transaction, requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight!, expiresAt: new Date(expiresAt).toISOString(),
      transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION",
    };
  }

  private checkMint(asset: InvestmentAsset, mint: MintInspection): void {
    if (mint.mint !== asset.mintAddress || ![SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(mint.program) ||
        asset.provider === "xstocks" && mint.program !== TOKEN_2022_PROGRAM_ADDRESS ||
        !Number.isInteger(mint.decimals) || mint.decimals < 0 || mint.decimals > 255 ||
        mint.extensions.some(({ name }) => !SAFE_EXTENSIONS.has(name)) ||
        new Set(mint.extensions.map(({ name }) => name)).size !== mint.extensions.length) fail("TECHNICAL_REVIEW_REQUIRED");
    const extensions = new Map(mint.extensions.map(({ name, state }) => [name, state]));
    const pause = extensions.get("pausableConfig");
    const defaultState = extensions.get("defaultAccountState");
    if (pause && pause.paused !== false || defaultState && defaultState.accountState !== "initialized") fail("TECHNICAL_REVIEW_REQUIRED");
    const scale = extensions.get("scaledUiAmountConfig");
    if (asset.provider === "xstocks" && !scale) fail("TECHNICAL_REVIEW_REQUIRED");
    if (scale) {
      try {
        if (typeof scale.multiplier !== "string" || typeof scale.newMultiplier !== "string" ||
            typeof scale.newMultiplierEffectiveTimestamp !== "string") throw new Error("Malformed scale.");
        effectiveMultiplier({ multiplier: scale.multiplier, newMultiplier: scale.newMultiplier,
          newMultiplierEffectiveTimestamp: scale.newMultiplierEffectiveTimestamp }, BigInt(Math.floor(this.now() / 1_000)));
        const activationMs = BigInt(scale.newMultiplierEffectiveTimestamp) * 1_000n;
        const now = BigInt(this.now());
        if (activationMs >= now - BigInt(CORPORATE_ACTION_WINDOW_MS) &&
            activationMs <= now + BigInt(CORPORATE_ACTION_WINDOW_MS + this.deps.policy.maxOrderLifetimeMs)) {
          throw new Error("Corporate action window.");
        }
      } catch { return fail("TECHNICAL_REVIEW_REQUIRED"); }
    }
  }

  private checkOrder(order: JupiterOrder, mint: string, inputRaw: string): bigint {
    if (order.inputMint !== mint || order.outputMint !== SOLANA_MAINNET_USDC_MINT ||
        order.inAmount !== inputRaw || order.taker !== this.deps.principal.walletAddress ||
        !order.requestId || order.requestId.length > 200 || !order.router || order.router.length > 200 ||
        !order.mode || order.mode.length > 100 || !canonicalBase64(order.transaction) ||
        !order.lastValidBlockHeight || !/^[1-9]\d{0,19}$/.test(order.lastValidBlockHeight) ||
        !order.expireAt) fail("ORDER_UNAVAILABLE");
    const outputRaw = u64(order.outAmount, "ORDER_UNAVAILABLE");
    if (!outputRaw) fail("ORDER_UNAVAILABLE");
    if (order.feeBps === null || !Number.isInteger(order.feeBps) || order.feeBps < 0 ||
        order.feeBps > this.deps.policy.maxFeeBps ||
        order.feeMint !== null && order.feeMint !== mint && order.feeMint !== SOLANA_MAINNET_USDC_MINT ||
        order.feeBps > 0 && order.feeMint === null || order.priceImpactPct === null ||
        percentBpsCeiling(order.priceImpactPct) > BigInt(this.deps.policy.maxPriceImpactBps)) fail("ORDER_OUT_OF_POLICY");
    expiry(order.expireAt, this.now(), this.deps.policy.maxOrderLifetimeMs, "ORDER_UNAVAILABLE");
    return outputRaw;
  }
}
