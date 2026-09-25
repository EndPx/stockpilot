# StockPilot submission video pack

Prepared September 26, 2026. This is a recording script and shot list, not a completed video or uploaded link. Narration is English to match the submission. Durations below are editorial targets; the supplied form does not specify a duration limit.

## Submission links

- GitHub Repository: https://github.com/EndPx/stockpilot
- Demo URL: https://stockpilot.endpx.cloud
- Pitch Video URL: paste the published pitch recording link after upload.
- Technical Video URL: paste the separate published technical recording link after upload.

Use two independently playable links. Check each in a signed-out browser. Do not substitute the app link for either video field.

## 1. Pitch video

Title: **StockPilot — An Investing Wallet for You and Your AI Agent**

Target: approximately 2 minutes, with product screens behind the narration. Keep technical configuration and console logs out of this video.

### 0:00–0:20 — The problem

Screen: StockPilot overview, then briefly the Wallet and Agents navigation.

> Today, an investor can research an asset in an AI chat, check their holdings in a wallet, and execute a trade in a separate application. Connecting those steps is useful. But giving an AI agent access to your money introduces a more important question: what is it actually allowed to do?

### 0:20–0:45 — The product

Screen: Pre-IPO catalog, Stocks catalog, then Wallet.

> StockPilot is an investing wallet for tokenized stocks and Pre-IPO assets on Solana. It brings asset discovery, real wallet balances, portfolio holdings, and trading into one application. Users can explore PreStocks and xStocks, see their available SOL and USDC, and review a supported trade before signing it themselves.

### 0:45–1:20 — The distinguishing feature

Screen: connected agent card, then its Policy screen. Show saved permissions and limits, without changing them during this section.

> StockPilot also connects to AI clients through MCP and OAuth. The key principle is that connecting an AI app does not, by itself, give it permission to spend. Wallet delegation and an execution policy are separate. The owner can choose BUY, SELL, SOL transfers, and USDC transfers independently, restrict supported assets and recipients, and set spending limits and an expiry.
>
> With delegation and an enabled policy, an agent can request execution without a new wallet-approval prompt for every transaction. Each operation still passes the application's checks and receives a persistent operation ID.

### 1:20–1:45 — Evidence

Screen: a confirmed transaction and corresponding holdings or balance change. Use ONE of these lines according to the evidence available at recording time.

**Use now, while the autonomous transaction is not confirmed:**

> We have completed a real manual BUY and SELL of Polymarket PreStocks on Solana mainnet. The connected agent can read markets, balances, and holdings. Delegated execution is implemented; its first mainnet attempt reached submission but was not confirmed. We distinguish submission from completion instead of reporting a pending operation as a successful investment.

**Replace only after an autonomous mainnet trade is independently confirmed:**

> Here is an agent-initiated Polymarket PreStocks trade, completed on Solana mainnet under the owner's saved policy. The operation, public transaction receipt, and resulting wallet holdings agree. No new per-transaction wallet-approval prompt was required for this delegated operation.

### 1:45–2:05 — Close

Screen: overview and live URL; small footer with repository link.

> StockPilot's goal is not to hide the wallet behind a chatbot. It is to make the boundary between researching, requesting, and executing an investment explicit. One investing wallet, with control for the owner and clearly scoped actions for the agent. Try StockPilot at stockpilot.endpx.cloud.

## 2. Technical demonstration

Title: **StockPilot Technical Demo — OAuth, Policy-Gated MCP, and Solana Execution**

Target: approximately 4 minutes. Record genuine actions and keep operation IDs and public signatures visible. Fast-forward waiting only with a visible label; never edit a pending result into a success.

### 0:00–0:35 — Wallet and data

Screen: Wallet; show public address, SOL, USDC, and holdings. Then briefly show separate Stocks and Pre-IPO catalogs.

> This is the live StockPilot application. Privy supplies the wallet login and embedded Solana wallet. Balances and supported holdings are read from Solana RPC. Catalog information comes from the asset providers. An indicative market price is not an executable trade quote.

### 0:35–1:05 — Agent connection

Screen: Agents, onboarding popup, existing OAuth-connected client. Show an OAuth flow only if a fresh connection is needed; do not revoke the working connection for the recording.

> MCP provides the tool interface, and WorkOS handles OAuth. OAuth identifies the connected client; it does not confer signing authority. The connection is bound to the StockPilot account and its verified wallet.

### 1:05–1:45 — Policy and signing boundary

Screen: agent Policy page. Show the actual saved delegated-wallet state, enabled BUY/SELL actions, asset allowlist, and operation/daily limits.

> An agent execution requires both owner-authorized wallet delegation and a saved execution policy. StockPilot checks the operation type, allowed asset or recipient, limits, expiry, and policy version. Reservation and status records are stored in PostgreSQL so concurrent requests cannot independently spend the same reserved budget.

Do not enable transfers, unlimited spending, or additional assets just to improve the recording. Explain only settings actually saved by the owner.

### 1:45–2:15 — Read tools

Screen: user's connected MCP client, with returned results legible. The user controls/records their AI client.

Suggested prompt:

```text
Use StockPilot to show my SOL and USDC balance, find Polymarket in Pre-IPO,
find AAPLx in Stocks, and show my current portfolio. Read-only; do not trade.
```

> The tools separate Pre-IPO and Stocks discovery. Balance shows available SOL and canonical USDC; portfolio shows supported investment holdings. These calls do not submit a transaction.

### 2:15–3:15 — One explicit trade, then receipt

Only begin this section after the old unresolved operation is closed by verified reconciliation and the owner confirms a fresh small test. A new `clientRequestId` means a new financial operation, not a status check.

Suggested user prompt for a new, explicitly authorized recording take:

```text
Buy Polymarket PreStocks with 0.10 USDC using StockPilot.
Submit only one new operation. If it is pending, use get_operation to check
that same operation; do not submit a replacement or create another request ID.
```

Capture the operation ID. If returned `SUBMITTED` or `UNKNOWN`, use a read-only follow-up:

```text
Check get_operation for OPERATION_ID. Do not buy, sell, transfer,
or submit a replacement transaction.
```

Narration:

> The server validates the prepared transaction, claims the signing and submission steps durably, and records its signature. Retries with the same request ID inspect the existing operation instead of making another trade. The RPC can forward the same signed transaction; that is different from generating a new transaction.
>
> Submitted is not confirmed. StockPilot reconciles the receipt and transaction effects before reporting completion. A missing receipt is not automatically treated as failure.

**If confirmed:** open its Solscan receipt, show successful finalization, and refresh `get_portfolio`/`get_balance`. Say exactly the amount spent and tokens received from the results, not the quoted estimate.

**If expired:** show `EXPIRED` honestly. Explain that the recent blockhash expired and two RPCs with positive historical controls found no landed transaction. This is a provider-based absence assessment, not a failed on-chain receipt. Do not claim an autonomous BUY succeeded or automatically make another one for the recording.

**If still unresolved:** show the pending status and stop transaction attempts. Use the already-confirmed owner-signed BUY/SELL evidence as the demonstrated settlement, clearly labeled manual.

### 3:15–4:00 — Architecture and scope

Screen: a simple caption or repository documentation, then the app.

> Next.js and TypeScript power the application. WorkOS provides OAuth, Privy provides wallet authorization and delegated signing, Neon PostgreSQL stores policies and the durable operation ledger, and Redis supports security and ephemeral state. Jupiter supplies supported swap routes, and Solana RPC is used for wallet state and transaction reconciliation.
>
> The current trading allowlist is Polymarket PreStocks and AAPLx. Catalog availability does not imply every product can be traded. Supported token amounts use their actual mint units; the interface separates market estimates from execution results.

Closing caption: repository, live URL, and the exact release used for the recording.

## Recording and publication checklist

- Prefer a 1920×1080 screen capture, browser zoom around 100–110%, clear microphone audio, and no background notifications.
- Keep wallet address and transaction signatures visible as public evidence; conceal email, API keys, OAuth codes, cookies, private keys, seed phrases, and protected server environment files.
- Do not show a URL containing OAuth callback codes or tokens. Use the stable app page after connection.
- Record the pitch and technical demo separately. Export MP4/H.264 with AAC audio for broad playback support.
- Keep waiting periods short with clearly labeled cuts or speed-up; retain a continuous capture of the result and its ID/signature for auditability.
- Upload only after reviewing both files. Use a publicly accessible or unlisted viewing link that does not require judges to request access.
- Play both links from a signed-out browser, check narration/subtitles, then paste them into the matching form fields.
- Do not claim autonomous settlement, unrestricted asset coverage, guaranteed investment returns, or security certification without corresponding evidence.

## Evidence log to fill before recording

| Item | Value |
| --- | --- |
| App release SHA | Fill from the verified deployed release |
| Owner-signed BUY/SELL receipts | Copy the two verified public signatures from existing history |
| Agent operation ID | Fill from the recorded take; distinguish it from the expired prior attempt |
| Agent signature and final status | Fill after read-only reconciliation |
| Wallet state before/after | Record actual SOL, USDC and token holdings |
| Pitch URL | Fill after upload and signed-out playback check |
| Technical URL | Fill after upload and signed-out playback check |
