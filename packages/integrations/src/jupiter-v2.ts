import { isSignature } from "@solana/kit";

const JUPITER_API_URL = "https://api.jup.ag";
const REQUEST_TIMEOUT_MS = 15_000;

export type JupiterCreateOrderInput = {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  taker: string;
};

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
