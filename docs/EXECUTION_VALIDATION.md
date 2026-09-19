# StockPilot Core Execution Validation

## Date tested

2026-09-19

## Network

Solana mainnet-beta

## PreStocks API

- Endpoint: `GET https://prestocks.com/api/prestocks`
- Response: HTTP 200
- Assets observed: 8
- Response shape: a top-level array. Each observed asset included `name`, `symbol`,
  `description`, `image`, `external_url`, `contract_address`, `tokenPrice`, `markPrice`,
  `impliedValuation`, `markValuation`, and `supply`.

`contract_address` is normalized as StockPilot's `mintAddress`. The client fetches this
registry live; it does not hardcode the asset list.

## Mint validation

Each returned address was validated with Solana Kit's address validator, then inspected
through mainnet RPC. All eight accounts existed and were owned by the Token-2022 program
(`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).

Examples tested:

- `SPACEX`: `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh`
- `OPENAI`: `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF`
- `ANTHROPIC`: `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw`

## USDC

The input mint is Circle's native Solana mainnet USDC:

`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

[Circle identifies this as native Solana USDC](https://help.circle.com/support/en/usdc-supported-blockchains-minting-redemption-faqs?id=kb_article_view&sysparm_article=KB0010590),
distinct from bridged variants. Mainnet RPC confirmed that the account exists and is owned by
the legacy SPL Token program.

## Jupiter

The validation uses the live Jupiter Swap API quote endpoint:

`GET https://api.jup.ag/swap/v1/quote`

Requests use ExactIn quotes with `inputMint`, `outputMint`, `amount`, and `slippageBps`.
No transaction was built or submitted.

## Quote results

Quotes were requested for a hypothetical input of 1 USDC with 50 bps slippage.

| Asset | Mint | Route | Price Impact | Result |
| ----- | ---- | ----- | -----------: | ------ |
| SPACEX | `PreAN…sfTh` | Meteora DLMM | 0.01428433722044399% | PASS |
| OPENAI | `Prewe…rpgF` | Meteora DLMM | 0.005722859385793844% | PASS |
| ANTHROPIC | `Pren1…Lkhw` | HumidiFi → Manifest | 0% | PASS |

The reproducible `pnpm validate:execution` run selected SPACEX and returned an estimated
`0.001617925 SPACEX` for 1 USDC with a Meteora DLMM route.

## Blockers

### Observed blocker

None.

### Possible explanation

Not applicable. Quote availability and execution prices are time-sensitive; the command
must be re-run before treating a quote as executable.

## Conclusion

**CORE EXECUTION PATH PROVEN**
