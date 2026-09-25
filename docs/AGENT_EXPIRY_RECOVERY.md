# Agent operation expiry recovery

`SUBMITTED` is an acknowledgment of submission, not evidence of chain settlement. A duplicate `clientRequestId` must never sign or send another transaction.

## Terminal expiry

Migration `0006_agent_operation_expiry.sql` introduces `EXPIRED` separately from `FAILED` (a finalized failed receipt) and `REJECTED` (preflight or pre-submission denial). It adds a bound, immutable evidence object and preserves the old operation ID and signature. It does not resolve any existing row automatically.

`get_operation` and `list_operations` reconcile read-only. The strict receipt/effect verifier runs first. Only an ordinary `PENDING` result—not a verifier error—can enter expiry assessment.

The assessment accepts recent-blockhash transactions only, waits at least 90 seconds after the durable submission timestamp, and refuses records older than 24 hours. Two separately operated HTTPS mainnet RPCs must agree on finalized expiry, blockhash invalidity, absent historical signature and absent finalized transaction. Their roots and response contexts must be fresh. Both must also retrieve a real earlier wallet transaction through the wallet history index and by its full receipt, binding signature, slot, block time and wallet participation.

This is a **trusted-provider absence determination**, not a cryptographic proof of complete historical indexing. Errors, conflicting observations, missing history, same-host RPC configuration, durable nonce, or mismatched stored message bindings keep the operation unresolved. An old record or a new wallet without a usable historical control needs operator investigation; it is never automatically released based on time alone.

The primary RPC is `SOLANA_RPC_URL`. The default secondary is the public Solana mainnet service at `https://solana-rpc.publicnode.com`; an operator can configure `SOLANA_EXPIRY_WITNESS_RPC_URL` to another independently operated provider. Never configure two aliases of the same provider. Only hostnames, not key-bearing RPC URL paths/queries, are persisted in evidence.

## Delivery

The application still makes one `sendTransaction` call for a claimed operation. `maxRetries: 5` permits the node to forward the **same already-signed transaction** to leaders. The Privy signing client's retry count remains zero. There is no new quote, signing, blockhash, operation, or transfer created by reconciliation.

## Operator recovery

Run inside the release's migration image with the protected runtime database and RPC environment. Do not copy secrets to a command line. The script selects exactly one supplied operation ID; it never uses an invented OAuth principal or calls a signer.

```sh
cd /app/apps/web
pnpm exec tsx --conditions=react-server scripts/reconcile-agent-operation.ts OPERATION_UUID
# Review the dry-run result, then only if authorized:
pnpm exec tsx --conditions=react-server scripts/reconcile-agent-operation.ts OPERATION_UUID --apply
```

Both modes use the production MCP evidence path. `--apply` repeats the reads and applies the result through the owner-bound, row-locked transition, recording the operation event. No SQL force-update or false `FAILED` receipt is used. The app must be running a migration-compatible release before recovery is applied. Read back the stored row and event, then check the wallet without submitting a replacement trade.

## Release gate

Use an explicit schema migration and app release, not `git-release.sh` (which intentionally refuses schema changes). Keep the prior image, Redis and runtime configuration. Apply `0006` through the checksum-checking migration runner with the migration role, replace only the app container, and verify image revision plus `/api/health`. No signer provisioning, policy changes, token minting, or wallet transaction is part of this release.

If app rollback is necessary, retain this additive schema and all evidence; never delete operations or reverse terminal accounting. An old UI may not describe `EXPIRED` correctly, so restore the compatible app before asking for new trades.
