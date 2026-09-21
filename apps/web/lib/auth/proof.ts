import { getAddressDecoder } from "@solana/kit";
import { parseSignInMessage, verifySignIn } from "@solana/wallet-standard-util";
import { AuthError } from "./errors";
import type { AuthSignInInput, AuthVerifyRequest, SerializedSignInOutput } from "./types";

function decodeBase64Url(value: unknown, expectedLength?: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }

  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== value ||
    (expectedLength !== undefined && bytes.length !== expectedLength)) {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }
  return bytes;
}

function isSerializedOutput(value: unknown): value is SerializedSignInOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<SerializedSignInOutput>;
  const account = output.account as Partial<SerializedSignInOutput["account"]> | undefined;

  return !!account &&
    typeof account.address === "string" &&
    typeof account.publicKey === "string" &&
    typeof output.signedMessage === "string" &&
    typeof output.signature === "string" &&
    (output.signatureType === undefined || output.signatureType === "ed25519");
}

export function parseAuthVerifyRequest(value: unknown): AuthVerifyRequest {
  if (!value || typeof value !== "object") {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }
  const request = value as Partial<AuthVerifyRequest>;

  if ((request.method !== "signIn" && request.method !== "signMessage") ||
    typeof request.requestId !== "string" ||
    request.requestId.length > 128 ||
    !isSerializedOutput(request.output)) {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }

  return request as AuthVerifyRequest;
}

function assertExpectedMessage(expected: AuthSignInInput, signedMessage: Uint8Array): void {
  const parsed = parseSignInMessage(signedMessage);

  if (!parsed) {
    throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
  }
  if (parsed.address !== expected.address) {
    throw new AuthError("AUTH_WALLET_MISMATCH", 401);
  }
  if (parsed.domain !== expected.domain || parsed.uri !== expected.uri) {
    throw new AuthError("AUTH_DOMAIN_MISMATCH", 401);
  }
  if (
    parsed.statement !== expected.statement ||
    parsed.version !== expected.version ||
    parsed.chainId !== expected.chainId ||
    parsed.nonce !== expected.nonce ||
    parsed.issuedAt !== expected.issuedAt ||
    parsed.expirationTime !== expected.expirationTime ||
    parsed.requestId !== expected.requestId ||
    parsed.notBefore !== undefined ||
    parsed.resources !== undefined
  ) {
    throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
  }
}

export function verifyAuthProof(expected: AuthSignInInput, request: AuthVerifyRequest): void {
  const { output } = request;
  const publicKey = decodeBase64Url(output.account.publicKey, 32);
  const signature = decodeBase64Url(output.signature, 64);
  const signedMessage = decodeBase64Url(output.signedMessage);

  if (signedMessage.length === 0 || signedMessage.length > 4_096) {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }
  if (output.account.address !== expected.address ||
    getAddressDecoder().decode(publicKey).toString() !== expected.address) {
    throw new AuthError("AUTH_WALLET_MISMATCH", 401);
  }

  assertExpectedMessage(expected, signedMessage);

  const verified = verifySignIn(expected, {
    account: {
      address: output.account.address,
      publicKey,
      chains: ["solana:mainnet"],
      features: [request.method === "signIn" ? "solana:signIn" : "solana:signMessage"],
    },
    signedMessage,
    signature,
    signatureType: output.signatureType,
  });

  if (!verified) {
    throw new AuthError("AUTH_SIGNATURE_INVALID", 401);
  }
}
