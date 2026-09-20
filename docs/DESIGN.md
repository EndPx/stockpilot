# StockPilot design foundation

Purpose: help users compare current official PreStocks data, inspect one asset,
and connect a Solana wallet. The live company table carries the page. Connecting
a wallet establishes identity only; it does not expose balances, trading, or
transaction signing.

- Colors: background #F7F8FA, surface #FFFFFF, text #111318, secondary #6B7280,
  border #E7E9EE, restrained indigo #4F46E5 for links and actions.
- Type: system sans-serif, 16px body, 14px table labels, 32–40px page titles;
  tabular numerals for prices. No external font request.
- Layout: 1120px maximum width, left-aligned content, 24–48px section gaps.
  One white table surface, not a card for every value. Details use a definition list.
- Navigation: use the StyleGallery split-nav pattern: one wrapping flex row,
  primary links first, and the wallet action pushed to the inline end with
  `margin-inline-start: auto`. Preserve DOM and focus order. Never add internal
  navigation scrolling.
- Primitives: 12px surface corners, 8px controls, 44px minimum control height,
  visible indigo keyboard focus. Logos have text fallbacks.
- Responsive: 20px mobile gutters, scrollable data table with a visible label;
  detail statistics collapse to two columns. The document owns vertical scrolling.
  Wallet addresses shorten visually on narrow screens while the accessible name
  retains the full address.
- States: distinct loading, empty, no search results, unavailable, and not found.
  Token Price and Mark Price remain separate; missing data is an em dash. The
  wallet control distinguishes pending, disconnected, connecting, connected,
  disconnecting, reconnecting, no-wallet, and recoverable error states.
- Wallet selector: use a focused modal dialog with the wallet trigger carrying
  `aria-haspopup="dialog"` and `aria-expanded`. Escape and the close control
  dismiss it and return focus to the trigger. Installed Wallet Standard wallets
  appear by discovered name; no wallet vendor is hardcoded.
- Motion: no decorative animation. Loading placeholders are static. Wallet state
  changes do not depend on motion and remain usable with reduced-motion settings.
- Content: errors use calm, actionable language and do not expose raw wallet or
  extension internals. The empty state explains that a compatible Solana wallet
  must be installed before connecting.

Review against brief: avoid portfolio statistics, feature cards, and transaction
controls. Show the provider, readable prices, an obvious path to asset details,
and an equally clear connection status. A keyboard-only user can operate every
wallet action; a mobile user receives the same states without clipped controls.

References:

- Layout mechanism: https://github.com/changeroa/StyleGallery/blob/main/patterns/in-line-grouping/split-nav.md
- Dialog interaction mechanism: https://beui.dev/r/popover/raw
