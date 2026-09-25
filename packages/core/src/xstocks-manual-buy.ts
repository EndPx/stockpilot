import { isAddress } from "@solana/kit";
import { assertAssetIdentity } from "@stockpilot/integrations/asset-domain";
import type { JupiterExecutionAdapter, JupiterOrder } from "@stockpilot/integrations/jupiter-v2";
import { InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import { ExecutionEligibilityService } from "@stockpilot/core/execution-eligibility";
import { inspectJupiterOrderValidity } from "@stockpilot/core/jupiter-order-validity";
import { parseUsdcAmount } from "@stockpilot/core/investments";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { parseRawU64 } from "@stockpilot/core/token-amounts";

const MAX_ORDER_BYTES = 1_232;
const MAX_USDC_RAW = 18_446_744_073_709_551_615n;

export type XStocksBuyErrorCode =
  | "INVALID_INPUT"
  | "CATALOG_UNAVAILABLE"
  | "ASSET_NOT_ALLOWED"
  | "PRODUCT_REVIEW_REQUIRED"
  | "TECHNICAL_REVIEW_REQUIRED"
  | "INVESTOR_REVIEW_REQUIRED"
  | "INSUFFICIENT_USDC"
  | "ORDER_UNAVAILABLE"
  | "ORDER_OUT_OF_POLICY"
  | "UNSIGNED_ENVELOPE_UNVERIFIED";

export class XStocksBuyError extends Error {
  constructor(readonly code: XStocksBuyErrorCode) {
    super(code);
    this.name = "XStocksBuyError";
  }
}

/** Server-owned per-person decision; a wallet or IP address alone is not legal eligibility. */
export type InvestorEligibilityReview = Readonly<{
  principalId: string;
  walletAddress: string;
  assetId: string;
  mintAddress: string;
  allowed: boolean;
  restrictionsComplete: boolean;
  evidenceId: string;
  reviewedAt: string;
  expiresAt: string;
}>;

export type XStocksBuyPolicy = Readonly<{
  maxFeeBps: number;
  maxPriceImpactBps: number;
  maxSlippageBps: number;
  maxProductReviewAgeMs: number;
  maxOrderLifetimeMs: number;
}>;

/** Must be supplied by the authenticated server session, never by trade arguments. */
export type XStocksBuyPrincipal = Readonly<{ principalId: string; walletAddress: string }>;

export type PreparedXStocksBuy = Readonly<{
  assetId: string;
  principalId: string;
  walletAddress: string;
  inputMint: typeof SOLANA_MAINNET_USDC_MINT;
  outputMint: string;
  inputRaw: string;
  quotedOutputRaw: string;
  /** Floor set by server policy; the later transaction validator must prove it. */
  requiredMinimumOutputRaw: string;
  outputDecimals: number;
  outputUnits: "RAW_TOKEN_2022_BASE_UNITS";
  router: string;
  mode: string;
  feeBps: number;
  feeMint: string | null;
  priceImpactPct: string;
  transaction: string;
  requestId: string;
  lastValidBlockHeight: string | null;
  expiresAt: string;
  /** This is an unsigned, unvalidated order. It is never permission to sign or submit. */
  transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION";
}>;

type PortfolioReader = Pick<{ getPortfolio(walletAddress: string): Promise<Portfolio> }, "getPortfolio">;
type InvestorReviewer = (input: { principalId: string; walletAddress: string; assetId: string; mintAddress: string }) => Promise<InvestorEligibilityReview | null>;

function fail(code: XStocksBuyErrorCode): never { throw new XStocksBuyError(code); }

function checkedTime(value: string, now: number, maxAgeMs: number): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now + 5_000 || now - parsed > maxAgeMs) fail("PRODUCT_REVIEW_REQUIRED");
  return parsed;
}

function percentageBpsCeiling(value: string): bigint {
  if (typeof value !== "string" || value.length > 24) fail("ORDER_OUT_OF_POLICY");
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) fail("ORDER_OUT_OF_POLICY");
  const scaledPercent = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return (scaledPercent * 100n + 999_999n) / 1_000_000n;
}

function validUnsignedTransaction(value: string): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length > 0 && bytes.length <= MAX_ORDER_BYTES && bytes.toString("base64") === value;
}

function validateOrder(order: JupiterOrder, expected: { wallet: string; mint: string; inputRaw: string }, policy: XStocksBuyPolicy, now: number): { outputRaw: bigint; expireAt: number } {
  if (order.inputMint !== SOLANA_MAINNET_USDC_MINT || order.outputMint !== expected.mint ||
      order.inAmount !== expected.inputRaw || order.taker !== expected.wallet ||
      !order.requestId || order.requestId.length > 200 || !order.router || !order.mode ||
      !validUnsignedTransaction(order.transaction)) fail("ORDER_UNAVAILABLE");
  let outputRaw: bigint;
  try { outputRaw = parseRawU64(order.outAmount); } catch { return fail("ORDER_UNAVAILABLE"); }
  if (outputRaw === 0n) fail("ORDER_UNAVAILABLE");
  if (order.feeBps === null || !Number.isInteger(order.feeBps) || order.feeBps < 0 || order.feeBps > policy.maxFeeBps ||
      order.feeBps > 0 && order.feeMint !== SOLANA_MAINNET_USDC_MINT && order.feeMint !== expected.mint ||
      order.feeMint !== null && order.feeMint !== SOLANA_MAINNET_USDC_MINT && order.feeMint !== expected.mint ||
      order.priceImpactPct === null || percentageBpsCeiling(order.priceImpactPct) > BigInt(policy.maxPriceImpactBps)) {
    fail("ORDER_OUT_OF_POLICY");
  }
  const validity = inspectJupiterOrderValidity(order, now, policy.maxOrderLifetimeMs);
  if (!validity) fail("ORDER_UNAVAILABLE");
  return { outputRaw, expireAt: validity.expiresAtMs };
}

/**
 * Builds a canonical xStocks order only after independent issuer/technical/person checks.
 * It never signs or submits; the returned transaction MUST pass an instruction-level
 * validator and a fresh eligibility/revocation check before any wallet interaction.
 */
export class XStocksManualBuyService {
  constructor(
    private readonly principal: XStocksBuyPrincipal,
    private readonly registry: Pick<InvestmentAssetRegistry, "getSnapshot">,
    private readonly technical: Pick<ExecutionEligibilityService, "validateForExecution">,
    private readonly portfolios: PortfolioReader,
    private readonly jupiter: Pick<JupiterExecutionAdapter, "createOrder">,
    private readonly reviewInvestor: InvestorReviewer,
    private readonly verifyUnsignedEnvelope: (transaction: string, walletAddress: string) => Promise<boolean>,
    private readonly policy: XStocksBuyPolicy,
    private readonly now: () => number = Date.now,
  ) {
    if (typeof verifyUnsignedEnvelope !== "function") fail("UNSIGNED_ENVELOPE_UNVERIFIED");
    if (!principal || typeof principal.principalId !== "string" || !principal.principalId ||
        principal.principalId.length > 200 || !isAddress(principal.walletAddress) ||
        !Number.isInteger(policy.maxFeeBps) || policy.maxFeeBps < 0 || policy.maxFeeBps > 1_000 ||
        !Number.isInteger(policy.maxPriceImpactBps) || policy.maxPriceImpactBps < 0 || policy.maxPriceImpactBps > 1_000 ||
        !Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps > 500 ||
        !Number.isInteger(policy.maxProductReviewAgeMs) || policy.maxProductReviewAgeMs < 1 || policy.maxProductReviewAgeMs > 86_400_000 ||
        !Number.isInteger(policy.maxOrderLifetimeMs) || policy.maxOrderLifetimeMs < 1 || policy.maxOrderLifetimeMs > 120_000) {
      throw new Error("Invalid server-bound xStocks BUY principal or policy.");
    }
  }

  async prepare(input: { assetId: string; amountUsd: string }): Promise<PreparedXStocksBuy> {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "assetId" && key !== "amountUsd") ||
        !/^xstocks:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.assetId)) fail("INVALID_INPUT");
    let amount;
    try { amount = parseUsdcAmount(input.amountUsd); } catch { return fail("INVALID_INPUT"); }
    const now = this.now();
    let snapshot;
    try { snapshot = await this.registry.getSnapshot("xstocks"); } catch { return fail("CATALOG_UNAVAILABLE"); }
    const source = snapshot.sources.find(({ provider }) => provider === "xstocks");
    if (!source || source.stale || snapshot.stale || !Number.isFinite(Date.parse(source.fetchedAt)) ||
        Date.parse(source.fetchedAt) > now + 5_000 || now - Date.parse(source.fetchedAt) > 300_000) fail("CATALOG_UNAVAILABLE");
    const asset = snapshot.assets.find(({ id }) => id === input.assetId);
    if (!asset) fail("ASSET_NOT_ALLOWED");
    try { assertAssetIdentity(asset); } catch { return fail("ASSET_NOT_ALLOWED"); }
    if (asset.provider !== "xstocks" || !["PUBLIC_EQUITY", "ETF"].includes(asset.marketType) ||
        asset.id !== `xstocks:${asset.mintAddress}` || asset.metadata?.isTradingHalted !== false ||
        !asset.metadata.classificationSource) fail("ASSET_NOT_ALLOWED");
    const availability = asset.availability;
    if (availability?.status !== "AVAILABLE" || !availability.restrictionsComplete || !availability.reviewedAt ||
        !availability.issuerTermsUrl?.startsWith("https://")) fail("PRODUCT_REVIEW_REQUIRED");
    const productReviewedAt = checkedTime(availability.reviewedAt, now, this.policy.maxProductReviewAgeMs);

    let technical;
    try { technical = await this.technical.validateForExecution(asset.id); } catch { return fail("TECHNICAL_REVIEW_REQUIRED"); }
    const mint = technical.findings.mint;
    const diagnosticQuote = technical.findings.quote;
    const validatedAt = Date.parse(technical.validatedAt);
    const technicalExpiry = Date.parse(technical.expiresAt);
    if (technical.assetId !== asset.id || technical.status !== "EXECUTABLE" || technical.findings.blockers.length ||
        !Number.isFinite(validatedAt) || validatedAt > this.now() + 5_000 || this.now() - validatedAt > 30_000 ||
        !Number.isFinite(technicalExpiry) || technicalExpiry <= this.now() ||
        mint?.mint !== asset.mintAddress || mint.program !== TOKEN_2022_PROGRAM_ADDRESS ||
        !Number.isInteger(mint.decimals) || mint.decimals < 0 || mint.decimals > 255 ||
        diagnosticQuote?.inputMint !== SOLANA_MAINNET_USDC_MINT || diagnosticQuote.outputMint !== asset.mintAddress ||
        diagnosticQuote.inputRaw !== "1000000" || !diagnosticQuote.venues.length) fail("TECHNICAL_REVIEW_REQUIRED");
    try { if (parseRawU64(diagnosticQuote.outputRaw) === 0n) fail("TECHNICAL_REVIEW_REQUIRED"); }
    catch { return fail("TECHNICAL_REVIEW_REQUIRED"); }

    let investor;
    try { investor = await this.reviewInvestor({ principalId: this.principal.principalId, walletAddress: this.principal.walletAddress, assetId: asset.id, mintAddress: asset.mintAddress }); }
    catch { return fail("INVESTOR_REVIEW_REQUIRED"); }
    const investorExpiry = investor ? Date.parse(investor.expiresAt) : Number.NaN;
    const investorReviewedAt = investor ? Date.parse(investor.reviewedAt) : Number.NaN;
    if (!investor || investor.principalId !== this.principal.principalId || investor.walletAddress !== this.principal.walletAddress ||
        investor.assetId !== asset.id || investor.mintAddress !== asset.mintAddress || !investor.allowed ||
        !investor.restrictionsComplete || !investor.evidenceId || investor.evidenceId.length > 200 ||
        !Number.isFinite(investorReviewedAt) || investorReviewedAt > this.now() + 5_000 ||
        !Number.isFinite(investorExpiry) || investorExpiry <= this.now()) fail("INVESTOR_REVIEW_REQUIRED");

    let portfolio;
    try { portfolio = await this.portfolios.getPortfolio(this.principal.walletAddress); } catch { return fail("INSUFFICIENT_USDC"); }
    if (portfolio.walletAddress !== this.principal.walletAddress || portfolio.funding.usdc.mintAddress !== SOLANA_MAINNET_USDC_MINT) {
      fail("INSUFFICIENT_USDC");
    }
    let availableRaw: bigint;
    try { availableRaw = portfolio.funding.usdc.amount === "0" ? 0n : BigInt(parseUsdcAmount(portfolio.funding.usdc.amount).amountRaw); }
    catch { return fail("INSUFFICIENT_USDC"); }
    if (BigInt(amount.amountRaw) > availableRaw || BigInt(amount.amountRaw) > MAX_USDC_RAW) fail("INSUFFICIENT_USDC");

    let order;
    try { order = await this.jupiter.createOrder({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: asset.mintAddress, amountRaw: amount.amountRaw, taker: this.principal.walletAddress }); }
    catch { return fail("ORDER_UNAVAILABLE"); }
    const checked = validateOrder(order, { wallet: this.principal.walletAddress, mint: asset.mintAddress, inputRaw: amount.amountRaw }, this.policy, this.now());
    let unsigned: boolean;
    try { unsigned = await this.verifyUnsignedEnvelope(order.transaction, this.principal.walletAddress); }
    catch { return fail("UNSIGNED_ENVELOPE_UNVERIFIED"); }
    if (unsigned !== true) fail("UNSIGNED_ENVELOPE_UNVERIFIED");
    const expiresAt = Math.min(
      technicalExpiry,
      investorExpiry,
      checked.expireAt,
      productReviewedAt + this.policy.maxProductReviewAgeMs,
      Date.parse(source.fetchedAt) + 300_000,
      this.now() + 120_000,
    );
    if (expiresAt <= this.now()) fail("TECHNICAL_REVIEW_REQUIRED");
    const minimumOutputRaw = checked.outputRaw * BigInt(10_000 - this.policy.maxSlippageBps) / 10_000n;
    if (minimumOutputRaw <= 0n) fail("ORDER_OUT_OF_POLICY");
    return {
      assetId: asset.id,
      principalId: this.principal.principalId,
      walletAddress: this.principal.walletAddress,
      inputMint: SOLANA_MAINNET_USDC_MINT,
      outputMint: asset.mintAddress,
      inputRaw: amount.amountRaw,
      quotedOutputRaw: checked.outputRaw.toString(),
      requiredMinimumOutputRaw: minimumOutputRaw.toString(),
      outputDecimals: mint.decimals,
      outputUnits: "RAW_TOKEN_2022_BASE_UNITS",
      router: order.router,
      mode: order.mode,
      feeBps: order.feeBps!,
      feeMint: order.feeMint,
      priceImpactPct: order.priceImpactPct!,
      transaction: order.transaction,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight,
      expiresAt: new Date(expiresAt).toISOString(),
      transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION",
    };
  }
}
