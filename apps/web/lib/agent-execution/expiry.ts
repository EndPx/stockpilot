import "server-only";
import { createHash } from "node:crypto";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { getSolanaRpcUrl } from "@/lib/solana/read-adapter";

const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,88}$/;
export type ExpiryCandidate = {
  id: string; status: string; walletAddress: string; createdAt: string; submittedAt: string | null;
  transactionSignature: string | null; messageFingerprint: string | null;
  preparedContext: { transaction: string; lastValidBlockHeight: string } | null;
};
type Witness = {
  // Hostname only: never persist API keys or an RPC URL path/query.
  host: string; genesisHash: string; finalizedSlot: number; finalizedBlockHeight: number;
  rootBlockTime: number; blockhashContextSlot: number; signatureContextSlot: number;
  blockhashValid: false; signatureAbsent: true; transactionAbsent: true;
  historyAnchorSignature: string; historyAnchorSlot: number; historyAnchorBlockTime: number;
};
export type AgentExpiryEvidence = {
  operationId: string; signature: string; messageFingerprint: string; blockhash: string;
  lastValidBlockHeight: string; observedAt: string; witnesses: Witness[];
};
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid expiry evidence");
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid expiry integer");
  return value;
}
function binding(input: ExpiryCandidate) {
  if (!input.transactionSignature || !SIGNATURE.test(input.transactionSignature) || !input.messageFingerprint ||
    !input.preparedContext || !/^[1-9]\d{0,15}$/.test(input.preparedContext.lastValidBlockHeight)) throw new Error("Missing expiry binding");
  const wire = Buffer.from(input.preparedContext.transaction, "base64");
  if (wire.length > 1232 || wire.toString("base64") !== input.preparedContext.transaction) throw new Error("Invalid wire");
  const tx = getTransactionDecoder().decode(wire);
  const fingerprint = createHash("sha256").update(Uint8Array.from(tx.messageBytes)).digest("base64url");
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (fingerprint !== input.messageFingerprint || message.version !== 0 || message.header.numSignerAccounts !== 1 ||
    message.staticAccounts[0] !== input.walletAddress || Object.values(tx.signatures).some(s => s !== null)) throw new Error("Invalid binding");
  const first = message.instructions[0];
  // Nonce advance must be the first instruction. Unknown loaded program IDs
  // are not eligible for this recovery path, even if upstream accepted them.
  if (!first || first.programAddressIndex >= message.staticAccounts.length ||
    (message.staticAccounts[first.programAddressIndex] === "11111111111111111111111111111111" &&
      first.data && first.data.length >= 4 && Buffer.from(first.data).readUInt32LE(0) === 4)) throw new Error("Not a recent-blockhash operation");
  return { blockhash: String(message.lifetimeToken), lastValidBlockHeight: input.preparedContext.lastValidBlockHeight };
}

/** Validate the evidence again under the operation's database lock. This is a
 * trusted-provider absence determination, NOT a finalized failed receipt. */
export function assertAgentExpiryEvidence(input: ExpiryCandidate, evidence: AgentExpiryEvidence, now = Date.now()): void {
  const bound = binding(input);
  const created = Date.parse(input.createdAt);
  const submitted = Date.parse(input.submittedAt ?? "");
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(created) || !Number.isFinite(submitted) || submitted < created ||
    now - submitted < 90_000 || now - created > 86_400_000 ||
    !Number.isFinite(observed) || now - observed < 0 || now - observed > 30_000 ||
    evidence.operationId !== input.id || evidence.signature !== input.transactionSignature ||
    evidence.messageFingerprint !== input.messageFingerprint || evidence.blockhash !== bound.blockhash ||
    evidence.lastValidBlockHeight !== bound.lastValidBlockHeight || !Array.isArray(evidence.witnesses) ||
    evidence.witnesses.length !== 2 || new Set(evidence.witnesses.map(w => w.host)).size !== 2) throw new Error("Expiry evidence mismatch");
  for (const w of evidence.witnesses) {
    row(w);
    if (typeof w.host !== "string" || !/^[a-z0-9.-]+$/.test(w.host) || w.genesisHash !== MAINNET ||
      BigInt(integer(w.finalizedBlockHeight)) <= BigInt(bound.lastValidBlockHeight) ||
      integer(w.blockhashContextSlot) < integer(w.finalizedSlot) || integer(w.signatureContextSlot) < w.finalizedSlot ||
      integer(w.rootBlockTime) * 1000 < observed - 120_000 || w.rootBlockTime * 1000 > observed + 30_000 ||
      w.blockhashValid !== false || w.signatureAbsent !== true || w.transactionAbsent !== true ||
      typeof w.historyAnchorSignature !== "string" || !SIGNATURE.test(w.historyAnchorSignature) || w.historyAnchorSignature === input.transactionSignature ||
      integer(w.historyAnchorSlot) >= w.finalizedSlot ||
      integer(w.historyAnchorBlockTime) * 1000 > created - 60_000) throw new Error("Insufficient expiry evidence");
  }
  if (Math.abs(evidence.witnesses[0].finalizedSlot - evidence.witnesses[1].finalizedSlot) > 64) throw new Error("RPC roots disagree");
}

/** Read only; fail closed on errors, observed signatures, stale/nonhistorical
 * RPCs, nonce messages or records older than 24 hours. No signing or sending. */
export async function readAgentOperationExpiry(input: ExpiryCandidate, options: {
  rpcUrls?: string[]; now?: () => number; fetcher?: typeof fetch;
} = {}): Promise<AgentExpiryEvidence | null> {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  try {
    if (!["SUBMITTED", "UNKNOWN"].includes(input.status) || !Number.isFinite(Date.parse(input.createdAt)) ||
      !Number.isFinite(Date.parse(input.submittedAt ?? "")) || now() - Date.parse(input.submittedAt!) < 90_000 ||
      now() - Date.parse(input.createdAt) > 86_400_000) return null;
    const bound = binding(input);
    const urls = (options.rpcUrls ?? [getSolanaRpcUrl(),
      process.env.SOLANA_EXPIRY_WITNESS_RPC_URL?.trim() || "https://solana-rpc.publicnode.com"]).map(s => new URL(s));
    if (urls.length !== 2 || new Set(urls.map(u => u.hostname)).size !== 2 ||
      urls.some(u => u.protocol !== "https:" || u.username || u.password || u.hash)) return null;
    const signal = AbortSignal.timeout(12_000);
    const witnesses = await Promise.all(urls.map(async url => {
      async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
        const response = await fetcher(url, { method: "POST", cache: "no-store", redirect: "error", signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (!response.ok) throw new Error("Expiry RPC unavailable");
        const payload = row(await response.json());
        if (payload.jsonrpc !== "2.0" || payload.id !== 1 || Object.hasOwn(payload, "error") || !Object.hasOwn(payload, "result")) throw new Error("Invalid expiry RPC");
        return payload.result;
      }
      const [genesis, root] = await Promise.all([rpc("getGenesisHash"), rpc("getSlot", [{ commitment: "finalized" }])]);
      if (genesis !== MAINNET) throw new Error("Wrong cluster");
      const slot = integer(root);
      const [height, rootTime, validResult, statusResult, transaction, history] = await Promise.all([
        rpc("getBlockHeight", [{ commitment: "finalized", minContextSlot: slot }]), rpc("getBlockTime", [slot]),
        rpc("isBlockhashValid", [bound.blockhash, { commitment: "finalized", minContextSlot: slot }]),
        rpc("getSignatureStatuses", [[input.transactionSignature], { searchTransactionHistory: true }]),
        rpc("getTransaction", [input.transactionSignature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]),
        rpc("getSignaturesForAddress", [input.walletAddress, { commitment: "finalized", minContextSlot: slot, limit: 100 }]),
      ]);
      const valid = row(validResult), status = row(statusResult);
      if (valid.value !== false || !Array.isArray(status.value) || status.value.length !== 1 || status.value[0] !== null ||
        transaction !== null || !Array.isArray(history) || !history.length || history.length > 100) throw new Error("Not absent");
      const entries = history.map(row);
      let previousSlot = slot;
      for (const entry of entries) {
        if (typeof entry.signature !== "string" || !SIGNATURE.test(entry.signature) || entry.signature === input.transactionSignature ||
          integer(entry.slot) > previousSlot) throw new Error("Invalid history");
        previousSlot = integer(entry.slot);
      }
      // A positive control prevents accepting two 'null's from a pruned or
      // unindexed provider. Both the wallet index and full historical receipt
      // must cover a transaction predating this operation.
      const anchor = entries.find(e => typeof e.blockTime === "number" && e.blockTime * 1000 <= Date.parse(input.createdAt) - 60_000);
      if (!anchor) throw new Error("No historical coverage");
      const receipt = row(await rpc("getTransaction", [anchor.signature,
        { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]));
      const tx = row(receipt.transaction);
      const keys = row(tx.message).accountKeys;
      if (receipt.slot !== anchor.slot || receipt.blockTime !== anchor.blockTime || !Object.hasOwn(row(receipt.meta), "err") ||
        !Array.isArray(tx.signatures) || !tx.signatures.length || tx.signatures[0] !== anchor.signature ||
        !tx.signatures.every(s => typeof s === "string" && SIGNATURE.test(s)) ||
        !Array.isArray(keys) || !keys.some(key => row(key).pubkey === input.walletAddress)) throw new Error("History control failed");
      return { host: url.hostname, genesisHash: MAINNET, finalizedSlot: slot, finalizedBlockHeight: integer(height),
        rootBlockTime: integer(rootTime), blockhashContextSlot: integer(row(valid.context).slot), signatureContextSlot: integer(row(status.context).slot),
        blockhashValid: false as const, signatureAbsent: true as const, transactionAbsent: true as const,
        historyAnchorSignature: String(anchor.signature), historyAnchorSlot: integer(anchor.slot), historyAnchorBlockTime: integer(anchor.blockTime) };
    }));
    const evidence: AgentExpiryEvidence = { operationId: input.id, signature: input.transactionSignature!,
      messageFingerprint: input.messageFingerprint!, ...bound, observedAt: new Date(now()).toISOString(), witnesses };
    assertAgentExpiryEvidence(input, evidence, now());
    return evidence;
  } catch { return null; }
}
