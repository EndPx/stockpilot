import type { InvestmentAsset, ExecutionStatus } from "@stockpilot/integrations/asset-domain";
import { inspectMarketMint, quoteMarketMint, MarketQuoteError, type MintInspection, type ReadOnlyQuote } from "@stockpilot/integrations/market-validation";
import { InvestmentAssetRegistry } from "./asset-registry.js";
import { normalizeTokenAmount, parseRawU64, type ScaleConfig, type TokenAmountSemantics } from "./token-amounts.js";
import { SOLANA_MAINNET_USDC_MINT, SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "./solana.js";

/** Server-owned evidence only; never accept this structure from a browser or agent. */
export type ProductReview = {
  assetId: string; mint: string; evidenceUrl: string; expiresAt: string;
  restrictionsComplete: boolean; restricted: boolean; tokenCompatibilityReviewed: boolean;
};
export type EligibilityResult = {
  assetId: string; status: ExecutionStatus; reason: string; validatedAt: string; expiresAt: string;
  findings: { mint?: MintInspection; amount?: TokenAmountSemantics; quote?: ReadOnlyQuote; restrictionReview?: string; blockers: string[] };
};
type Dependencies = {
  inspect?: (mint: string) => Promise<MintInspection>;
  quote?: (mint: string) => Promise<ReadOnlyQuote>;
  review?: (asset: InvestmentAsset, mint: MintInspection) => ProductReview | null;
  now?: () => number;
};
const known = new Set(["metadataPointer", "tokenMetadata", "scaledUiAmountConfig", "permanentDelegate", "defaultAccountState", "pausableConfig", "confidentialTransferMint", "transferHook"]);

/** Lazy, read-only technical gate. NOT user authorization, legal clearance or a BUY API. */
export class ExecutionEligibilityService {
  private readonly cache = new Map<string, { fingerprint: string; result: EligibilityResult }>();
  private readonly pending = new Map<string, { fingerprint: string; task: Promise<EligibilityResult> }>();
  private readonly now: () => number;
  constructor(private readonly registry: InvestmentAssetRegistry, private readonly deps: Dependencies = {}) { this.now = deps.now ?? Date.now; }

  getCachedStatus(assetId: string): ExecutionStatus {
    const cached = this.cache.get(assetId);
    if (!cached || Date.parse(cached.result.expiresAt) <= this.now()) return "UNKNOWN";
    return cached.result.status;
  }

  async validateForExecution(assetId: string): Promise<EligibilityResult> {
    const snapshot = await this.registry.getSnapshot();
    const asset = snapshot.assets.find(({ id }) => id === assetId);
    const deny = (reason: string) => { this.cache.delete(assetId); return this.result(assetId, "UNAVAILABLE", reason); };
    if (!asset) return deny("UNREGISTERED_ASSET");
    if (asset.provider !== "xstocks") return deny("PRESTOCKS_EXECUTION_PATH_UNCHANGED");
    const source = snapshot.sources.find(({ provider }) => provider === asset.provider);
    if (!source || source.stale || this.now() - Date.parse(source.fetchedAt) > 300_000 || Date.parse(source.fetchedAt) > this.now() + 5_000) return deny("STALE_REGISTRY");
    const fingerprint = JSON.stringify(asset);
    const cached = this.cache.get(assetId);
    if (cached?.fingerprint === fingerprint && Date.parse(cached.result.expiresAt) > this.now()) return structuredClone(cached.result);
    // No cached result may survive a failed/changed canonical lookup.
    this.cache.delete(assetId);
    const existing = this.pending.get(assetId);
    if (existing) return existing.fingerprint === fingerprint ? structuredClone(await existing.task) : deny("CATALOG_CHANGED_DURING_VALIDATION");
    if (this.pending.size >= 8) return deny("VALIDATION_CAPACITY_REACHED");
    const task = this.validate(asset).then((result) => {
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(assetId, { fingerprint, result: structuredClone(result) });
      return result;
    }).finally(() => this.pending.delete(assetId));
    this.pending.set(assetId, { fingerprint, task });
    return structuredClone(await task);
  }

  private result(assetId: string, status: ExecutionStatus, reason: string): EligibilityResult {
    const now = this.now();
    return { assetId, status, reason, validatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), findings: { blockers: reason === "TECHNICAL_CHECKS_PASSED" ? [] : [reason] } };
  }

  private async validate(asset: InvestmentAsset): Promise<EligibilityResult> {
    const result = this.result(asset.id, "UNAVAILABLE", "VALIDATION_INCOMPLETE");
    const stop = (status: ExecutionStatus, reason: string) => { result.status = status; result.reason = reason; result.findings.blockers = [reason]; return result; };
    let mint: MintInspection;
    try { mint = await (this.deps.inspect ?? inspectMarketMint)(asset.mintAddress); }
    catch { return stop("UNAVAILABLE", "MINT_READ_FAILED"); }
    result.findings.mint = mint;
    if (mint.mint !== asset.mintAddress || ![SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(mint.program)) return stop("UNSUPPORTED", "MINT_IDENTITY_OR_PROGRAM_MISMATCH");
    if (mint.extensions.some(({ name }) => !known.has(name))) return stop("UNSUPPORTED", "UNSUPPORTED_TOKEN_EXTENSION");
    const states = new Map(mint.extensions.map(({ name, state }) => [name, state]));
    const pause = states.get("pausableConfig");
    const defaultState = states.get("defaultAccountState");
    const hook = states.get("transferHook");
    if (pause && typeof pause.paused !== "boolean" || defaultState && !["initialized", "frozen"].includes(String(defaultState.accountState)) || hook && !(hook.programId === null || typeof hook.programId === "string")) return stop("UNSUPPORTED", "MALFORMED_EXTENSION_STATE");
    if (pause?.paused === true || defaultState?.accountState === "frozen" || asset.metadata?.isTradingHalted === true || asset.availability?.status === "RESTRICTED") return stop("RESTRICTED", "ISSUER_OR_TOKEN_RESTRICTION");
    if (hook && hook.programId !== null) return stop("UNSUPPORTED", "ACTIVE_TRANSFER_HOOK");
    let scale: ScaleConfig | null = null;
    try {
      const state = states.get("scaledUiAmountConfig");
      if (state) {
        const timestamp = state.newMultiplierEffectiveTimestamp;
        if (typeof state.multiplier !== "string" || typeof state.newMultiplier !== "string" || !(typeof timestamp === "string" || typeof timestamp === "number" && Number.isSafeInteger(timestamp))) throw new Error("Invalid scale.");
        scale = { multiplier: state.multiplier, newMultiplier: state.newMultiplier, newMultiplierEffectiveTimestamp: String(timestamp) };
        const activationMs = BigInt(scale.newMultiplierEffectiveTimestamp) * 1000n;
        if (activationMs > BigInt(this.now()) && activationMs < BigInt(Date.parse(result.expiresAt))) result.expiresAt = new Date(Number(activationMs)).toISOString();
      }
      result.findings.amount = normalizeTokenAmount({ rawAmount: "1000000", decimals: mint.decimals, scale, unixSeconds: BigInt(Math.floor(this.now() / 1000)) });
    } catch { return stop("UNSUPPORTED", "UNSUPPORTED_AMOUNT_SEMANTICS"); }
    let review: ProductReview | null;
    try { review = this.deps.review?.(asset, mint) ?? null; } catch { return stop("UNAVAILABLE", "PRODUCT_REVIEW_FAILED"); }
    const reviewValid = !!review && review.assetId === asset.id && review.mint === asset.mintAddress && /^https:\/\//.test(review.evidenceUrl) && Date.parse(review.expiresAt) > this.now();
    result.findings.restrictionReview = reviewValid ? review!.evidenceUrl : "Not reviewed for StockPilot; route availability cannot waive issuer terms.";
    if (reviewValid && review!.restricted) return stop("RESTRICTED", "PRODUCT_REVIEW_RESTRICTED");
    try {
      const quote = await (this.deps.quote ?? quoteMarketMint)(asset.mintAddress);
      if (quote.inputMint !== SOLANA_MAINNET_USDC_MINT || quote.outputMint !== asset.mintAddress || quote.inputRaw !== "1000000" || parseRawU64(quote.outputRaw) === 0n || !quote.venues.length) throw new Error("Quote mismatch.");
      result.findings.quote = quote;
      result.findings.amount = normalizeTokenAmount({ rawAmount: quote.outputRaw, decimals: mint.decimals, scale, unixSeconds: BigInt(Math.floor(this.now() / 1000)) });
    } catch (error) { return stop("UNAVAILABLE", error instanceof MarketQuoteError ? error.reason : "QUOTE_UNAVAILABLE_OR_INVALID"); }
    if (asset.marketType === "PUBLIC_MARKET_PRODUCT" || !asset.metadata?.classificationSource) return stop("UNAVAILABLE", "CLASSIFICATION_REVIEW_REQUIRED");
    if (!reviewValid || !review!.restrictionsComplete || !review!.tokenCompatibilityReviewed) return stop("UNAVAILABLE", "PRODUCT_AND_TOKEN_REVIEW_REQUIRED");
    result.expiresAt = new Date(Math.min(Date.parse(result.expiresAt), Date.parse(review!.expiresAt))).toISOString();
    if (Date.parse(result.expiresAt) <= this.now()) return stop("UNAVAILABLE", "VALIDATION_EXPIRED");
    result.status = "EXECUTABLE"; result.reason = "TECHNICAL_CHECKS_PASSED"; result.findings.blockers = [];
    return result;
  }
}
