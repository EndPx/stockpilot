# StockPilot: tokenized stocks and a human-authorized agent control plane

Status: architecture correction, 2026-09-23. This document supersedes PreStocks-only **product positioning**, not the proven human execution security boundary. No agent execution, credential issuance, database, sell or automation is implemented by this revision.

Target identity decision (2026-09-23): replace Phantom/Wallet Standard login
entirely with Google sign-in and a user-owned Privy embedded Solana wallet at a
separately accepted cutover. Agent delegation remains a later explicit opt-in;
the current SIWS deployment stays unchanged until the replacement is verified.
See [PRIVY_MIGRATION.md](PRIVY_MIGRATION.md) for the new identity and signing
boundaries. The SIWS account descriptions below document the current system and
must not be mistaken for the target authentication design.

> Your AI agent for tokenized stocks on Solana.

This is the product direction. Today the app exposes official PreStocks discovery, wallet authentication, portfolio reads and the existing human BUY flow. Mainnet acceptance remains unproven. Public equities and the agent control plane must not be advertised as operational until their gates pass.

## Domain boundaries

```text
User → verified Solana wallet → StockPilot account
     → Client → Credential → Grant → Request → Approval
     → existing secure execution → on-chain confirmation → Audit
```

| Entity | Ownership and meaning |
| --- | --- |
| Account | Server-established identity linked to a SIWS-verified wallet; client input never selects the execution wallet. |
| Client | One external AI application/integration, with its own account ownership, identity, status, policy, credentials and audit history. Unrelated agents never share a key. |
| Credential | StockPilot-issued client authentication, **not a wallet private key**. Future key, OAuth and MCP authorization mechanisms implement the same identity boundary. |
| Grant | Server-controlled permissions, assets/categories, per-investment and daily USDC limits, expiry and revocation. Checked for every operation, not merely when the key is issued. |
| Request | Immutable exact investment intent plus prepared transaction commitment. Tenant-scoped request ID supports read-only polling and idempotent submission. |
| Approval | Human decision on that exact request, followed by an independent wallet signature. Approval alone is not signing authority. |
| Audit | Append-only account/client/request-attributed history; no credentials or private signing material. |

Credential storage is limited to credential ID, client ID, display prefix, cryptographically secure hash, creation time, last-used time and revocation state. Generate high-entropy random secrets; show plaintext only once at issuance over an authenticated protected response; never log/cache/store plaintext. Use constant-time verification, rate limiting and immediate revocation checks. Rotation issues a new secret and atomically revokes the old credential; never silently keep both active. This is a design, not an implemented key endpoint.

## Policies and immutable approvals

Model the future modes `ALWAYS_APPROVE`, `APPROVE_ABOVE_LIMIT`, `AUTONOMOUS_WITHIN_POLICY`. Only `ALWAYS_APPROVE` may be operational in the MVP. The other values are reserved, rejected by future MVP request handlers, and must not appear as enabled settings.

An approval commitment includes: schema version, request ID, client ID, account ID, verified wallet, asset ID, provider, market type, canonical output mint, canonical funding mint, exact integer funding amount, transaction message hash and expiry. Include quote bounds/fees in the human review and approved message. Obtain all canonical values server-side. Any relevant change requires a **new** immutable request and approval; an old signature/approval cannot authorize a replacement quote or blockhash.

Use unique idempotency keys scoped to account + client, bound to intent hash. A reused key with different parameters is rejected. Polling reads one existing request; it must never prepare, sign, submit or retry a transaction. Reserve and reconcile daily limits atomically to prevent parallel-request bypass. Recheck grant, credential/client revocation, wallet, expiry and registry freshness immediately before execution. Revocation invalidates pending authorization; already-submitted transactions cannot be recalled.

## Request state machine

```text
PENDING_APPROVAL → APPROVED → SIGNING → SUBMITTED → CONFIRMED
        ↓             ↓         ↓          ↓
 REJECTED/EXPIRED  EXPIRED/   FAILED/     FAILED only with
 /CANCELLED        CANCELLED CANCELLED   authoritative failure
```

Allowed values are exactly `PENDING_APPROVAL`, `APPROVED`, `SIGNING`, `SUBMITTED`, `CONFIRMED`, `REJECTED`, `EXPIRED`, `FAILED`, `CANCELLED`. Creation/validation failures before a valid request need not invent a request state. Terminal requests cannot be mutated or retried in place. A timeout after submission remains SUBMITTED with an unresolved/reconciliation condition; lack of confirmation is not proof of failure. SIGNING expiry is enforced before accepting/submitting the signed artifact. A fresh transaction needs fresh approval.

Audit event vocabulary: `CLIENT_CREATED`, `CLIENT_REVOKED`, `CREDENTIAL_CREATED`, `CREDENTIAL_ROTATED`, `CREDENTIAL_REVOKED`, `INVESTMENT_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `INVESTMENT_SUBMITTED`, `INVESTMENT_CONFIRMED`, `INVESTMENT_FAILED`. Include event ID, time, account ID, client ID, request/approval correlation, reason code and transaction signature where applicable. Cancellation and grant changes also need explicit versioned events when implemented. Do not hide them inside unrelated event names.

## Market universe and registry

| Market type | Provider (existing lowercase convention) | Eligibility |
| --- | --- | --- |
| PRE_IPO | prestocks | Official PreStocks only. No competing private-company tokens, wrappers or synthetics. |
| PUBLIC_EQUITY | xstocks | Issuer-verified publicly listed equities/ETFs only; canonical Solana deployment and integration checks required. |

Uppercase PRESTOCKS/XSTOCKS in the product brief refer to these lowercase provider values. Preserve existing mint-based IDs: `prestocks:<Solana mint>`; use `xstocks:<Solana mint>` for future verified deployments. A ticker is presentation/search metadata, not authority. Mint-based identity does not drift on renaming and distinguishes different deployments. Never accept a client-supplied output mint or provider URL.

`InvestmentAssetRegistry` provides list/search, exact ID lookup, verified mint lookup, provider/category filtering and structural eligibility checks. Provider adapters normalize external shapes. A provider must be explicitly registered by server code; payloads cannot register providers. Runtime validation rejects forbidden pairs, invalid/mismatched namespaced IDs, duplicate IDs and duplicate mints. Classification alone is **not proof of provenance**: only trusted canonical provider output may enter the registry.

Keep `AssetService` as the PreStocks compatibility adapter, preserving its cache/freshness behavior and the current symbol-only human BUY endpoint. The new registry is a foundation, not a reason to silently broaden execution. Future migration changes request input to `{assetId, amountUsd}`, resolves server-side, updates transaction authorization bindings, and adds security tests before enabling any new provider. Existing authorization must not accept a public ticker accidentally.

Availability metadata should include review/available/restricted/unavailable status, reason, issuer terms URL, known restricted jurisdictions, review timestamp and completeness of restrictions. A missing location is not permission. No invasive location tracking. Token provenance, valid mint, displayed availability, user legal eligibility and live route are separate checks. Never infer legal availability from a routable pool.

Portfolio expansion is deferred until safe provider activation: group by market type/provider, show only supported canonical mints, apply xStocks Token-2022 scaled-UI multipliers without double scaling, and keep integer raw units for transaction math. Do not imply direct share ownership or substitute underlying-stock price for token market price without labeling it.

## Route plan (not fake screens)

| Route | Purpose | Current scope |
| --- | --- | --- |
| `/app` | Overview, supported positions and funding balance | Existing operational page |
| `/markets` | Provider-attributed discovery; All / Pre-IPO / Public Stocks when safe | Existing PreStocks view; split gated by validation |
| `/approvals` | Pending queue, exact review, sign/reject | Future, no placeholder actions |
| `/clients` | Isolated agent identity and policy | Future |
| `/credentials` | One-time issued client key lifecycle | Future; never wallet secrets |
| `/activity` | Attributed request/approval/execution history | Future |
| `/settings` | Account and wallet preferences | Future |

Current read-only MCP market tools are separate: `list_stocks`/`get_stock` and `list_pre_ipo`/`get_pre_ipo`. No `swap_token`, arbitrary mint purchase, arbitrary instruction execution or wallet signer is exposed to agents. Do not add dead navigation to unimplemented pages.

## Delivery gate

Research → asset classifications → registry foundation → xStocks canonical/routing/rebasing/eligibility validation. Only a clean validation permits production provider activation and category UI. Keep execution frozen; no mainnet trade in this task. Next implementation must separately prove raw/scaled amount semantics and issuer eligibility requirements before the agent request/approval phase.
