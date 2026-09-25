# Manual and agent wallet execution

## Status — 25 September 2026

The implementation in release `483f73d` includes owner-signed manual BUY/SELL
and owner-delegated agent wallet actions. Deployment is in progress at this
documentation checkpoint; live image/health verification is still pending.
No real finalized BUY, SELL, or agent transfer has been verified in the current
acceptance record. This document supersedes the execution-disabled statements
in earlier readiness reports; those reports remain historical evidence.

An enabled `/api/health` flag means operator configuration is available, not
that a wallet is delegated, an agent has spending permission, or a transaction
has settled. Local tests exercise the authorization, instruction verification,
single-send, and reconciliation boundaries; they are not mainnet acceptance.

## Owner test handoff

1. Sign in to StockPilot and check **Wallet**. Confirm the exact public address,
   SOL network balance, and canonical USDC balance. Provider/RPC errors must be
   resolved rather than treated as zero balances.
2. For a manual trade, open one of the two supported products below, choose
   BUY or SELL and an amount, review the prepared transaction, then sign with
   that same Privy wallet. Completion requires a finalized result, not merely a
   submitted signature. Network fees and token-account rent require additional SOL.
3. For agent execution, connect the AI host through OAuth and open its entry
   under **Agents**. Explicitly connect **Wallet automation**, then save the
   agent's **Automatic actions** policy. Both permissions are required; the
   initial policy enables nothing. Saving policy does not initiate a trade.
4. Ask the agent for the selected operation using one unique `clientRequestId`
   for that exact intent. Retain the returned operation ID/signature. Use
   `get_operation` to reconcile an unresolved result; never replace its ID merely
   because the browser, signer, or network timed out.
5. Record finalized status, exact token/SOL effects, and the explorer signature;
   then refresh balances and holdings. The submission may only claim a real
   execution demonstration once this evidence exists. The owner chooses and
   authorizes the assets, amounts, and any transfer recipient.

## Supported trading scope

| Product | Canonical Solana mint | SELL amount/limit precision |
| --- | --- | --- |
| Polymarket PreStocks | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | 9 decimals, base token units |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 8 decimals, base token units, not Scaled UI shares |

Manual and agent trades reuse the two-product preparer and the configured
`STOCKPILOT_DEMO_TRADER_WALLET` binding. BUY spends mainnet USDC; SELL receives
USDC. The owner selects the amount; no hidden $0.10 application cap is applied.
Exact positive u64 amounts, available balances, a fresh canonical issuer
snapshot, supported token extensions, and the strict transaction-effect verifier
remain mandatory. The bounded routes are currently Meteora DLMM for Polymarket
and Raydium CLMM for AAPLx. An unavailable or unsupported route is a refusal,
not permission to trust arbitrary transaction bytes.

The broader Stocks/Pre-IPO catalog is discovery, not a promise that every row
can trade. The demo records the owner's Indonesia/non-U.S./issuer-terms
declaration; this is not independent legal clearance or a suitability decision.
All private-company exposure remains official PreStocks, not arbitrary SPL tokens.

## Agent permissions and MCP

| Independent owner permission | Tools | Amount/cap units |
| --- | --- | --- |
| BUY | `buy_stock`, `buy_pre_ipo` | USDC, 6 decimals |
| SELL | `sell_stock`, `sell_pre_ipo` | Per-asset base tokens, precision above |
| Transfer SOL | `transfer_sol` | SOL, 9 decimals |
| Transfer USDC | `transfer_usdc` | Canonical USDC, 6 decimals |

Each action requires the agent's current enabled permission, overall automation
opt-in, unexpired policy, live client credential/OAuth binding, and verified
wallet delegation. BUY/SELL also require an allowed asset and the saved owner
eligibility statements. Transfer permissions are separate from trade permissions;
they require a recipient allowlist or an explicit **Any supported wallet** choice.
Recipients are standard on-curve Solana wallets, not self, token accounts, or
program vaults. USDC uses only the canonical mainnet mint and verified ATAs.

Limits are per operation and rolling 24 hours. SELL caps are separate per asset.
An explicit **Unlimited** selection removes that particular StockPilot principal
cap; it does not bypass balance, transaction, fee/rent, expiry, or provider checks.
Network fees and account rent are additional to principal caps and have their
own verified transaction bounds. StockPilot checks/reserves the owner-authored
policy durably and rechecks it at signing/submission boundaries. Privy's
provider policy separately limits instruction families and global expiry; it
does not independently reproduce every per-agent recipient or budget rule.

The market tools remain `list_stocks`, `get_stock`, `list_pre_ipo`, and
`get_pre_ipo`; `get_balance` reads SOL/USDC and `get_portfolio` reads supported
holdings. Issuer USD prices are indicative cached data, not an on-chain contract
price or executable quote. `get_operation` reconciles one agent operation;
`list_operations` lists that client's recent operation records. Existing
`request_investment` and approval tools retain their consent-only behavior and
never authorize wallet signing by themselves.

## Finality, recovery, and cancellation

The database binds an operation to account, client, wallet, intent, policy version,
and `clientRequestId`. A changed intent cannot reuse the same ID. A durable send
fence permits one submission attempt; concurrent/repeated calls recover the
existing operation rather than sign or send again. Unresolved manual and agent
work also uses a wallet-level lock to prevent an overlapping spend.

`CONFIRMED` requires finalized Solana evidence with verified transaction and
balance effects. `FAILED` is a verified finalized on-chain failure.
`REJECTED` describes a proven stop before submission or an acknowledged RPC
preflight rejection; it is not a failed on-chain transaction. `SUBMITTED` and
`UNKNOWN` remain unresolved. Timeout, missing RPC history, expired blockhash,
or a lost HTTP response alone does not establish failure or free the reserved
budget. No automatic resubmission or replacement transaction is performed.

Disabling a policy, revoking the client, or expiring delegation stops future
authorized signing/submission checks. It cannot recall a transaction that has
already been submitted. A stuck unknown result needs authoritative chain or
submission evidence before resolution; do not delete its ledger row to retry.

## Six-day server authorization and renewal

The release setup provisions a Privy signing authorization that expires **six
days after initial provisioning**, not six days after each deployment. Both
StockPilot runtime checks and the Privy policy enforce the expiration.
The provisioning helper accepts only an explicit future expiry within seven
days. An owner's **No policy expiry** selection does not override this separate
server expiry. There is no automatic renewal job.

Before `PRIVY_EXECUTION_EXPIRES_AT`, the operator must deliberately renew the
server authorization and publish the updated protected configuration. The
existing release helper reuses its protected signer file; rerunning a deployment
does not renew it. Provision a replacement using the reviewed provisioning
workflow and a new protected output file, investigate any partial/ambiguous
provider creation before retrying, and keep the private authorization key out
of logs, repository files, URLs, and browser storage. If signer/policy IDs change,
the owner must reconnect wallet automation and its server readiness must be
verified again. Pending operation IDs remain recovery-only across renewal.

## Evidence and implementation pointers

The authoritative paths are the manual preparer/verifier under
`apps/web/lib/investments`, the agent gateway under
`apps/web/lib/agent-execution`, the durable policy/operation store in
`apps/web/lib/control-plane/agent-operations.ts`, and the delegated signer in
`apps/web/lib/privy/delegated-signer.ts`. Migration `0005_agent_wallet_operations.sql`
adds the agent execution ledger and shared wallet lock; the release procedure
must separately verify migration/runtime privileges and the resulting app image.

Focused tests cover exact amount parsing, owner/CSRF isolation, policy conflicts,
revocation/expiry, atomic caps, duplicate/ambiguous attempts, strict transfers,
and finalized reconciliation. Those tests and successful builds establish local
implementation evidence only. Deployment health, owner opt-in, real signing,
and finalized mainnet execution remain distinct acceptance checks.

**Next action:** check the deployed `/api/health` and exact release image, then
open **Agents → your connected agent** to inspect wallet readiness and configure
only the permissions needed for the owner-led acceptance test above.
