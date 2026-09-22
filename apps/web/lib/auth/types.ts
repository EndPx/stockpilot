export const AUTH_ERROR_CODES = [
  "AUTH_CHALLENGE_EXPIRED",
  "AUTH_CHALLENGE_INVALID",
  "AUTH_SIGNATURE_INVALID",
  "AUTH_WALLET_MISMATCH",
  "AUTH_DOMAIN_MISMATCH",
  "AUTH_REPLAY_DETECTED",
  "AUTH_REQUEST_INVALID",
  "AUTH_DISABLED",
  "AUTH_UNAVAILABLE",
  "AUTH_RATE_LIMITED",
  "SESSION_INVALID",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export type AuthSignInInput = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: "1";
  chainId: "solana:mainnet";
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  requestId: string;
};

export type AuthChallengeToken = {
  kind: "challenge";
  input: AuthSignInInput;
  expiresAt: number;
};

export type AuthSessionToken = {
  kind: "session";
  walletAddress: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

export type AuthSession = {
  authenticated: true;
  walletAddress: string;
  expiresAt: string;
};

export type AuthProofMethod = "signIn" | "signMessage";

export type SerializedSignInOutput = {
  account: {
    address: string;
    publicKey: string;
  };
  signedMessage: string;
  signature: string;
  signatureType?: "ed25519";
};

export type AuthVerifyRequest = {
  method: AuthProofMethod;
  requestId: string;
  output: SerializedSignInOutput;
};

export type AuthErrorResponse = {
  error: {
    code: AuthErrorCode;
    message: string;
  };
};
