import { isAddress } from "@solana/kit";

export const SOLANA_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM_OWNERS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

type AccountInfoResponse = {
  result?: { value?: { owner?: unknown } | null };
};

type TokenSupplyResponse = {
  result?: { value?: { decimals?: unknown } };
};

export type MintValidation = {
  mintAddress: string;
  validPublicKey: boolean;
  accountExists: boolean;
  tokenProgramOwner: string | null;
  isTokenMint: boolean;
};

/** Validates base58 public-key syntax and verifies a token-program-owned account on mainnet. */
export async function validateSolanaMint(mintAddress: string): Promise<MintValidation> {
  const validPublicKey = isAddress(mintAddress);
  if (!validPublicKey) {
    return { mintAddress, validPublicKey, accountExists: false, tokenProgramOwner: null, isTokenMint: false };
  }

  const response = await fetch(SOLANA_MAINNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [mintAddress, { encoding: "base64" }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Solana RPC request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as AccountInfoResponse;
  const owner = payload.result?.value?.owner;
  const tokenProgramOwner = typeof owner === "string" ? owner : null;

  return {
    mintAddress,
    validPublicKey,
    accountExists: tokenProgramOwner !== null,
    tokenProgramOwner,
    isTokenMint: tokenProgramOwner !== null && TOKEN_PROGRAM_OWNERS.has(tokenProgramOwner),
  };
}

/** Returns the mint's on-chain decimal precision. */
export async function getSolanaTokenDecimals(mintAddress: string): Promise<number> {
  if (!isAddress(mintAddress)) throw new Error("Cannot inspect decimals for an invalid Solana address.");

  const response = await fetch(SOLANA_MAINNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenSupply",
      params: [mintAddress],
    }),
  });
  if (!response.ok) throw new Error(`Solana RPC request failed with HTTP ${response.status}.`);

  const payload = (await response.json()) as TokenSupplyResponse;
  const decimals = payload.result?.value?.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Solana RPC returned no token decimals for this mint.");
  }
  return decimals;
}
