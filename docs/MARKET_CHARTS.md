# Token-price history

Public xStocks and private PreStocks detail pages share a read-only chart. It is
single-pool DEX token-price history in USD, not an underlying equity feed, company
valuation, executable quote, return on the user's holdings, or trading permission.
The issuer's current PreStocks Token/Mark Price comparison remains separate.

The API identifies `priceBasis: "PROVIDER_REPORTED"`. A prominent notice before the
chart explains that normalization for token multipliers/splits is **not verified**;
these prices must not be compared directly with issuer quotes or wallet balances.
No balance/portfolio/execution calculation consumes chart data.

During live QA, SPACEX's mint reported a 5x Scaled UI multiplier and issuer supply
matched scaled on-chain supply. Its GeckoTerminal candle price was approximately
five times the issuer quote. This establishes a material unit discrepancy, not
proof of GeckoTerminal's historical raw-versus-scaled semantics. Per the
[Solana integration guide](https://solana.com/docs/tokens/extensions/scaled-ui-amount/integration-guide),
historical conversions need historical multiplier context, including when updates
were applied. Consequently we do not divide historical candles by today's
multiplier. The limitation is disclosed for **both** public and private tokens.

## Data contract

`GET /api/market-history?provider=xstocks&mint=<canonical-mint>&range=1d`

Only `provider`, `mint` and `range` are accepted, once each. The server rechecks the
exact provider/mint against its official discovery registry before any history
read, including a cache hit. Excluded private-exposure xStocks stay excluded.
No wallet, URL, pool, chain, token symbol or arbitrary time window is accepted.

The fixed GeckoTerminal Solana token-pools endpoint discovers an eligible canonical
USDC or wrapped-SOL pair with positive liquidity. Eligible pools are ranked by
highest 24-hour USD trading volume, then liquidity, then pool address. Missing or
null volume counts as unavailable/zero, so inactive pools fall back to liquidity;
malformed, negative, nonfinite or unsafe volume fails closed. This display-history
heuristic favors recent trading activity, not execution quality or trade safety.
Pool identity and both token relationships are checked; OHLCV response metadata
must match both selected mints. USD currency and the actual
target mint are explicit request parameters, including when it is the quote token.
No third-party iframe, browser script, new API key or CSP exception is used.

| Control | Window | Completed candle interval |
| --- | --- | --- |
| 1D | 24 hours | 15 minutes |
| 1W | 7 days | 1 hour |
| 1M | 30 days | 4 hours |

Windows end on the latest completed interval boundary. Data is sorted by actual
UTC timestamp and filtered to that window. Missing trading intervals remain gaps;
no price is carried forward. Conflicting duplicate timestamps and invalid values
are omitted and disclosed. Entirely invalid/ambiguous data produces an unavailable
error, not a successful empty result. Identical duplicates are deduplicated.

Each upstream request rejects redirects and is bounded to 512 KiB. The entire
two-request job has a 10-second deadline. OHLC prices are finite and within
`[1e-15, 1e15]`, volume is nonnegative and no greater than `MAX_SAFE_INTEGER`, and
candles must obey OHLC ordering. No automatic retry or polling is implemented.

## Operational limits

The free provider's current [official API specification](https://api.geckoterminal.com/docs/v2/swagger.json)
describes an approximately 10-request/minute variable limit. StockPilot admits
at most two concurrent jobs and reserves two calls for each. Reservations stay
counted while pending and for 60 seconds after completion/failure, limiting actual
upstream calls conservatively to eight per rolling minute. Rejected work is not
queued. Failures have a 15-second cooldown; the API returns sanitized 503 with
`Retry-After: 60`, never raw provider errors.

Successful and genuine empty series are cached for five minutes in a 128-entry
LRU. In-flight jobs and active failure cooldowns cannot be evicted; simultaneous
identical requests share work. Results are cloned before returning. No expired
series is substituted when the source fails.

This limiter is process-local and fits the current single-process VPS container.
Before horizontal scaling, use a shared budget. A few simultaneous uncached asset
visits can exhaust the free allowance; the UI explains temporary unavailability.
Not every catalog asset has a supported pool or history in every selected period.

Pool links and visible “Powered by CoinGecko” attribution accompany each chart.
Sources: [GeckoTerminal API guide](https://apiguide.geckoterminal.com/),
[GeckoTerminal terms](https://www.geckoterminal.com/terms-conditions), and
[CoinGecko API terms](https://www.coingecko.com/en/api_terms).
Provider availability, terms and permitted use require continued review for a
commercial launch; this feature is not a legal-compliance certification.

## Verification

Mocked regressions cover canonical boundaries, hostile/malformed upstream data,
closed windows, duplicates, numeric bounds, gap rendering, safe attribution,
keyboard inspection/table parity, unavailable/empty states, cache admission,
singleflight and completion-retained rate limits. Browser checks use actual
provider data; test fixtures are never rendered as live prices.

Financial execution and agent execution remain disabled in VPS Compose. This
feature changes neither wallet/session security nor the execution primitive.

### Release checks — 2026-09-23

- `pnpm test`: 206/206 passed (109 core/integration, 44 client/auth, 53 server).
- React Doctor scoped to changed/untracked web files, telemetry and supply-chain
  uploads disabled: zero issues after hoisting shared Intl formatters.
- Production-build browser QA: AAPLx 1D/1W/1M returned actual candles; SPACEX 1D
  returned 30 sparse candles after the active-pool correction. No gap filling.
- Keyboard Home changed the selected price/timestamp, range changes clear the
  previous plot while loading, and the expandable equivalent data table worked.
- 375/768/1280 CSS widths have no document overflow; period targets are 44x44px.
  Browser-observed empty and simulated network-error states remained distinct;
  the temporary browser request block was removed and explicit Retry was tested.
- Independent adapter/API review passed, including the provider-budget timing
  fix and activity-based pool selection. Full Lighthouse medians and a financial
  unit-normalization certification were not performed or claimed.
