import { isAddress } from "@solana/kit";

export const SOLANA_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM_OWNERS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

type AccountInfoResponse = {
  result?: { value?: { owner?: unknown } | null };
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

