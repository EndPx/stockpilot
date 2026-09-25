import {
  AccountRole, address, appendTransactionMessageInstructions, compileTransaction,
  compressTransactionMessageUsingAddressLookupTables, createTransactionMessage,
  getBase58Decoder, getTransactionEncoder, isSignature, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Blockhash, type Instruction,
} from "@solana/kit";

const JUPITER_API_URL = "https://api.jup.ag";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const REQUEST_TIMEOUT_MS = 15_000;

export type JupiterCreateOrderInput = {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  taker: string;
};

export type JupiterBuildInput = JupiterCreateOrderInput & {
  slippageBps: number;
  /** Server-selected DEX label, never passed through from an untrusted client. */
  directDex?: "Meteora DLMM" | "Raydium CLMM";
};

export type JupiterBuildInstruction = Readonly<{
  programId: string;
  accounts: readonly Readonly<{ pubkey: string; isSigner: boolean; isWritable: boolean }>[];
  data: string;
}>;

export type JupiterBuild = Readonly<{
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: readonly Readonly<{ swapInfo: Readonly<{ label: string }> }>[];
  computeBudgetInstructions: readonly JupiterBuildInstruction[];
  setupInstructions: readonly JupiterBuildInstruction[];
  swapInstruction: JupiterBuildInstruction;
  cleanupInstruction: JupiterBuildInstruction | null;
  otherInstructions: readonly JupiterBuildInstruction[];
  tipInstruction: JupiterBuildInstruction | null;
  addressesByLookupTableAddress: Readonly<Record<string, readonly string[]>>;
  blockhashWithMetadata: Readonly<{ blockhash: readonly number[]; lastValidBlockHeight: number }>;
}>;

export type JupiterOrder = {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  taker: string;
  router: string;
  mode: string;
  feeBps: number | null;
  feeMint: string | null;
  priceImpactPct: string | null;
  transaction: string;
  lastValidBlockHeight: string | null;
  expireAt: string | null;
};

export type JupiterExecuteInput = {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: string;
};

export type JupiterExecutionResult = {
  status: "Success" | "Failed";
  signature: string | null;
  code: number | null;
  error: string | null;
  totalInputAmount: string | null;
  totalOutputAmount: string | null;
};

export interface JupiterExecutionAdapter {
  createOrder(input: JupiterCreateOrderInput): Promise<JupiterOrder>;
  execute(input: JupiterExecuteInput): Promise<JupiterExecutionResult>;
}

export class JupiterOrderError extends Error {
  readonly providerCode: number | null;

  constructor(message = "Jupiter could not prepare this investment.", providerCode: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "JupiterOrderError";
    this.providerCode = providerCode;
  }
}

export class JupiterOrderNotExecutableError extends JupiterOrderError {
  constructor(providerCode: number | null = null) {
    super("Jupiter did not return an executable transaction.", providerCode);
    this.name = "JupiterOrderNotExecutableError";
  }
}

export class JupiterExecutionError extends Error {
  constructor(options?: ErrorOptions) {
    super("Jupiter execution request failed.", options);
    this.name = "JupiterExecutionError";
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Jupiter response has no ${field}.`);
  }
  return value;
}

function rawAmount(value: unknown, field: string): string {
  const amount = requiredString(value, field);
  if (!/^\d+$/.test(amount)) throw new Error(`Jupiter response has an invalid ${field}.`);
  return amount;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error("Jupiter response has an invalid lastValidBlockHeight.");
}

function providerCode(payload: Record<string, unknown>): number | null {
  const value = payload.errorCode ?? payload.code;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildInstruction(value: unknown): JupiterBuildInstruction {
  const instruction = object(value);
  const accounts = instruction?.accounts;
  if (!instruction || typeof instruction.programId !== "string" || !instruction.programId ||
      typeof instruction.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(instruction.data) ||
      !Array.isArray(accounts) || accounts.length > 64) throw new JupiterOrderError("Jupiter returned an invalid build instruction.");
  const canonical = Buffer.from(instruction.data, "base64");
  if (canonical.toString("base64") !== instruction.data || canonical.length > 1_232) {
    throw new JupiterOrderError("Jupiter returned an invalid build instruction.");
  }
  return {
    programId: instruction.programId,
    data: instruction.data,
    accounts: accounts.map((item) => {
      const account = object(item);
      if (!account || typeof account.pubkey !== "string" || !account.pubkey ||
          typeof account.isSigner !== "boolean" || typeof account.isWritable !== "boolean") {
        throw new JupiterOrderError("Jupiter returned an invalid build account.");
      }
      return { pubkey: account.pubkey, isSigner: account.isSigner, isWritable: account.isWritable };
    }),
  };
}

/** Normalization only. A build is not executable until compiled and independently validated. */
export function normalizeJupiterBuild(payload: unknown, expected: JupiterBuildInput): JupiterBuild {
  const value = object(payload);
  if (!value || value.inputMint !== expected.inputMint || value.outputMint !== expected.outputMint ||
      value.inAmount !== expected.amountRaw || value.swapMode !== "ExactIn" ||
      value.slippageBps !== expected.slippageBps || !Array.isArray(value.routePlan) ||
      value.routePlan.length === 0 || value.routePlan.length > 8) {
    throw new JupiterOrderError("Jupiter returned an invalid swap build.");
  }
  const output = rawAmount(value.outAmount, "outAmount");
  const threshold = rawAmount(value.otherAmountThreshold, "otherAmountThreshold");
  if (BigInt(output) === 0n || BigInt(threshold) === 0n || BigInt(threshold) > BigInt(output)) {
    throw new JupiterOrderError("Jupiter returned an invalid swap threshold.");
  }
  if (typeof value.priceImpactPct !== "string" ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,30})?$/.test(value.priceImpactPct) ||
      Number(value.priceImpactPct) > 5) {
    throw new JupiterOrderError("Jupiter returned excessive price impact.");
  }
  const blockhash = object(value.blockhashWithMetadata);
  if (!blockhash || !Array.isArray(blockhash.blockhash) || blockhash.blockhash.length !== 32 ||
      !blockhash.blockhash.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      !Number.isSafeInteger(blockhash.lastValidBlockHeight) || Number(blockhash.lastValidBlockHeight) <= 0) {
    throw new JupiterOrderError("Jupiter returned an invalid swap blockhash.");
  }
  const lookups = value.addressesByLookupTableAddress === null ? {} : object(value.addressesByLookupTableAddress);
  if (!lookups || Object.keys(lookups).length > 4 || Object.values(lookups).some((entries) =>
    !Array.isArray(entries) || entries.length > 256 || entries.some((entry) => typeof entry !== "string" || !entry))) {
    throw new JupiterOrderError("Jupiter returned invalid address lookup tables.");
  }
  const list = (field: string): JupiterBuildInstruction[] => {
    const items = value[field];
    if (!Array.isArray(items) || items.length > 16) throw new JupiterOrderError("Jupiter returned invalid swap instructions.");
    return items.map(buildInstruction);
  };
  const optional = (field: string) => value[field] == null ? null : buildInstruction(value[field]);
  const routePlan = value.routePlan.map((step) => {
    const info = object(object(step)?.swapInfo);
    if (!info || typeof info.label !== "string" || !info.label) throw new JupiterOrderError("Jupiter returned an invalid route plan.");
    return { swapInfo: { label: info.label } };
  });
  return {
    inputMint: expected.inputMint, outputMint: expected.outputMint, inAmount: expected.amountRaw,
    outAmount: output, otherAmountThreshold: threshold, slippageBps: expected.slippageBps,
    priceImpactPct: value.priceImpactPct,
    routePlan,
    computeBudgetInstructions: list("computeBudgetInstructions"),
    setupInstructions: list("setupInstructions"),
    swapInstruction: buildInstruction(value.swapInstruction),
    cleanupInstruction: optional("cleanupInstruction"),
    otherInstructions: list("otherInstructions"),
    tipInstruction: optional("tipInstruction"),
    addressesByLookupTableAddress: lookups as Record<string, string[]>,
    blockhashWithMetadata: {
      blockhash: blockhash.blockhash as number[],
      lastValidBlockHeight: blockhash.lastValidBlockHeight as number,
    },
  };
}

/** Compilation is not authorization. The resulting bytes still need owner-bound effect review. */
export function assembleJupiterBuildTransaction(build: JupiterBuild, taker: string): string {
  if (build.computeBudgetInstructions.some((item) => item.programId === COMPUTE_BUDGET_PROGRAM &&
      Buffer.from(item.data, "base64")[0] === 2)) {
    throw new JupiterOrderError("Jupiter unexpectedly supplied a compute-unit limit.");
  }
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, 1_000_000, true);
  const computeLimitInstruction: JupiterBuildInstruction = {
    programId: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Buffer.from(limit).toString("base64"),
  };
  const toInstruction = (item: JupiterBuildInstruction): Instruction => ({
    programAddress: address(item.programId),
    accounts: item.accounts.map((account) => ({
      address: address(account.pubkey),
      role: account.isSigner
        ? account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: Uint8Array.from(Buffer.from(item.data, "base64")),
  });
  const instructions = [
    computeLimitInstruction, ...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...build.otherInstructions,
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ].map(toInstruction);
  if (instructions.length === 0 || instructions.length > 32) throw new JupiterOrderError("Jupiter build has too many instructions.");
  const lookups = Object.fromEntries(Object.entries(build.addressesByLookupTableAddress)
    .map(([key, entries]) => [address(key), entries.map((entry) => address(entry))])) as Record<Address, Address[]>;
  const blockhash = getBase58Decoder().decode(Uint8Array.from(build.blockhashWithMetadata.blockhash)) as Blockhash;
  const compiled = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => appendTransactionMessageInstructions(instructions, message),
    (message) => compressTransactionMessageUsingAddressLookupTables(message, lookups),
    (message) => setTransactionMessageFeePayer(address(taker), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({ blockhash,
      lastValidBlockHeight: BigInt(build.blockhashWithMetadata.lastValidBlockHeight) }, message),
    (message) => compileTransaction(message),
  );
  const bytes = getTransactionEncoder().encode(compiled);
  if (bytes.length > 1_232) throw new JupiterOrderError("Jupiter build exceeds the Solana transaction limit.");
  return Buffer.from(bytes).toString("base64");
}

export function normalizeJupiterOrder(payload: unknown, expected: JupiterCreateOrderInput): JupiterOrder {
  const value = object(payload);
  if (!value) throw new JupiterOrderError();

  const code = providerCode(value);
  if (typeof value.error === "string" || typeof value.errorMessage === "string") {
    throw new JupiterOrderError("Jupiter could not prepare this investment.", code);
  }

  try {
    const inputMint = requiredString(value.inputMint, "inputMint");
    const outputMint = requiredString(value.outputMint, "outputMint");
    const inAmount = rawAmount(value.inAmount, "inAmount");
    const taker = requiredString(value.taker, "taker");
    if (
      inputMint !== expected.inputMint ||
      outputMint !== expected.outputMint ||
      inAmount !== expected.amountRaw ||
      taker !== expected.taker
    ) {
      throw new Error("Jupiter order does not match the requested investment.");
    }

    const transaction = typeof value.transaction === "string" ? value.transaction : "";
    if (!transaction) throw new JupiterOrderNotExecutableError(code);

    return {
      requestId: requiredString(value.requestId, "requestId"),
      inputMint,
      outputMint,
      inAmount,
      outAmount: rawAmount(value.outAmount, "outAmount"),
      taker,
      router: requiredString(value.router, "router"),
      mode: requiredString(value.mode, "mode"),
      feeBps: nullableNumber(value.feeBps),
      feeMint: nullableString(value.feeMint),
      priceImpactPct: nullableString(value.priceImpactPct),
      transaction,
      lastValidBlockHeight: integerString(value.lastValidBlockHeight),
      expireAt: nullableString(value.expireAt),
    };
  } catch (cause) {
    if (cause instanceof JupiterOrderError) throw cause;
    throw new JupiterOrderError("Jupiter returned an invalid investment order.", code, { cause });
  }
}

export function normalizeJupiterExecution(payload: unknown): JupiterExecutionResult {
  const value = object(payload);
  if (!value || (value.status !== "Success" && value.status !== "Failed")) {
    throw new JupiterExecutionError({ cause: new Error("Malformed Jupiter execution response.") });
  }
  const totalInputAmount = value.totalInputAmount === undefined || value.totalInputAmount === null
    ? null
    : rawAmount(value.totalInputAmount, "totalInputAmount");
  const totalOutputAmount = value.totalOutputAmount === undefined || value.totalOutputAmount === null
    ? null
    : rawAmount(value.totalOutputAmount, "totalOutputAmount");
  const result: JupiterExecutionResult = {
    status: value.status,
    signature: nullableString(value.signature),
    code: nullableNumber(value.code),
    error: nullableString(value.error),
    totalInputAmount,
    totalOutputAmount,
  };
  if (
    result.status === "Success" &&
    (!result.signature || !isSignature(result.signature) || result.totalInputAmount === null || result.totalOutputAmount === null)
  ) {
    throw new JupiterExecutionError({ cause: new Error("Successful Jupiter execution is incomplete.") });
  }
  return result;
}

type Fetch = typeof fetch;

export class JupiterV2Adapter implements JupiterExecutionAdapter {
  constructor(
    private readonly apiKey: string | null,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = JUPITER_API_URL,
  ) {}

  async build(input: JupiterBuildInput): Promise<JupiterBuild> {
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 100) {
      throw new JupiterOrderError("Invalid manual swap slippage.");
    }
    const url = new URL("/swap/v2/build", this.baseUrl);
    url.searchParams.set("inputMint", input.inputMint);
    url.searchParams.set("outputMint", input.outputMint);
    url.searchParams.set("amount", input.amountRaw);
    url.searchParams.set("taker", input.taker);
    url.searchParams.set("slippageBps", String(input.slippageBps));
    if (input.directDex) {
      url.searchParams.set("dexes", input.directDex);
      // A 30-account ceiling prevents Metis from splitting this tiny demo
      // order across multiple pools, which the verifier intentionally rejects.
      url.searchParams.set("maxAccounts", "30");
    }
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json", ...(this.apiKey ? { "x-api-key": this.apiKey } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new JupiterOrderError("Jupiter could not build this swap.");
      const build = normalizeJupiterBuild(await response.json(), input);
      if (input.directDex && (build.routePlan.length !== 1 ||
          build.routePlan[0].swapInfo.label !== input.directDex ||
          build.cleanupInstruction || build.otherInstructions.length || build.tipInstruction)) {
        throw new JupiterOrderError("Jupiter did not return the required direct route.");
      }
      return build;
    } catch (cause) {
      if (cause instanceof JupiterOrderError) throw cause;
      throw new JupiterOrderError("Jupiter could not build this swap.", null, { cause });
    }
  }

  async createOrder(input: JupiterCreateOrderInput): Promise<JupiterOrder> {
    const url = new URL("/swap/v2/order", this.baseUrl);
    url.searchParams.set("inputMint", input.inputMint);
    url.searchParams.set("outputMint", input.outputMint);
    url.searchParams.set("amount", input.amountRaw);
    url.searchParams.set("taker", input.taker);

    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json", ...(this.apiKey ? { "x-api-key": this.apiKey } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const value = object(payload);
        throw new JupiterOrderError("Jupiter could not prepare this investment.", value ? providerCode(value) : null);
      }
      return normalizeJupiterOrder(payload, input);
    } catch (cause) {
      if (cause instanceof JupiterOrderError) throw cause;
      throw new JupiterOrderError(undefined, null, { cause });
    }
  }

  async execute(input: JupiterExecuteInput): Promise<JupiterExecutionResult> {
    const body: Record<string, string> = {
      signedTransaction: input.signedTransaction,
      requestId: input.requestId,
    };
    if (input.lastValidBlockHeight) body.lastValidBlockHeight = input.lastValidBlockHeight;

    try {
      const response = await this.fetchImpl(new URL("/swap/v2/execute", this.baseUrl), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new JupiterExecutionError();
      return normalizeJupiterExecution(await response.json());
    } catch (cause) {
      if (cause instanceof JupiterExecutionError) throw cause;
      throw new JupiterExecutionError({ cause });
    }
  }
}
