# StockPilot design foundation

Purpose: help users compare current official PreStocks data, inspect one asset,
connect a Solana wallet, prove ownership of that wallet, review its StockPilot
portfolio, and explicitly approve a USDC investment into an official PreStocks
asset. The live company table carries Markets; the overview makes funding and
official PreStocks holdings legible; the asset page owns the first transaction
flow without exposing a generic swap surface.

- Colors: background #F7F8FA, surface #FFFFFF, text #111318, secondary #6B7280,
  border #E7E9EE, restrained indigo #4F46E5 for links and actions.
- Type: system sans-serif, 16px body, 14px table labels, 32–40px page titles;
  tabular numerals for prices. No external font request.
- Layout: 1120px maximum width, left-aligned content, 24–48px section gaps.
  One white table surface, not a card for every value. Details use a definition list.
- Portfolio overview: group Portfolio Estimate, Available to Invest, and Network
  Balance in one bordered summary surface with separators. Keep Investments in one
  separate list surface. Do not turn every number or holding into a floating card.
- Asset investment layout: use the StyleGallery sidebar relationship inside the
  existing asset detail surface. Asset information remains the flexible primary
  region and the 18rem investment panel is the secondary region. Let both regions
  wrap naturally when the primary region cannot remain at least 16rem wide. The
  document keeps scroll ownership; the investment panel never becomes its own
  scrolling column.
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
  disconnecting, reconnecting, no-wallet, and recoverable error states. A
  connected wallet separately distinguishes signed out, signing in, signed in,
  and recoverable authentication failure. The primary authentication action
  keeps one stable position while its label and disabled state communicate
  progress.
- Portfolio states: do not request private balances until authentication is
  confirmed. Preserve the summary layout with static skeletons while loading.
  Authentication expiry, Solana RPC failure, and PreStocks metadata failure each
  receive explicit copy and recovery. Zero investments remains a useful state:
  positive USDC is presented as available capital with an Explore Markets link.
- Investment entry states: disconnected shows “Connect Wallet to Invest”;
  connected but unauthenticated shows “Sign in to Invest”; authenticated shows
  Available to Invest, one USDC amount field, a Max shortcut, and “Review
  Investment.” Invalid precision, zero, insufficient USDC, expired authentication,
  unavailable provider data, and unavailable execution infrastructure each use
  distinct actionable copy. The browser never accepts a mint, route, slippage,
  fee, or destination wallet from the user.
- Investment review: open a focused modal dialog only after the server prepares
  an executable order. Show Invest, Receive (estimated), Asset, Price impact when
  supplied, Routing, Network fee when supplied, StockPilot fee as $0, destination
  wallet, and the order expiry. “Approve in Wallet” is the sole signing action.
  Closing the dialog or pressing Escape before signing restores focus to “Review
  Investment.” While wallet approval or submission is pending, disable dismissal
  and keep one stable action position with explicit progress copy.
- Investment terminal states: wallet rejection returns to the review with
  “Investment cancelled. No transaction was submitted.” An expired order requires
  a fresh review and never signs or retries automatically. Submission failure keeps
  the error and safe next action visible. Success replaces the review with actual
  input and output amounts reported by Jupiter, a Solscan transaction link, and a
  View Portfolio action; it also refreshes the private portfolio from chain data.
- Wallet selector: use a focused modal dialog with the wallet trigger carrying
  `aria-haspopup="dialog"` and `aria-expanded`. Escape and the close control
  dismiss it and return focus to the trigger. Installed Wallet Standard wallets
  appear by discovered name; no wallet vendor is hardcoded.
- Motion: no decorative animation. Loading placeholders are static. Wallet state
  changes do not depend on motion and remain usable with reduced-motion settings.
  Investment dialog view changes are immediate rather than spatially animated.
  The adapted BeUI morphing-modal mechanism contributes viewport layering, body
  scroll containment, and separated backdrop/panel responsibilities only.
- Authentication: connection and authentication are never presented as the same
  state. “Sign out” removes the StockPilot session without disconnecting the
  wallet. “Disconnect” also removes the session. A restored session is shown as
  authenticated only when its wallet address matches the currently connected
  wallet.
- Content: errors use calm, actionable language and do not expose raw wallet or
  extension internals. The empty state explains that a compatible Solana wallet
  must be installed before connecting.
- Transaction safety copy: “estimated” always qualifies prepared output. Never
  say an investment succeeded from a wallet signature alone; success requires a
  successful Jupiter execute response and uses its actual total input/output.
- Financial labels: USDC is “Available to Invest”; native SOL is “Network Balance”
  and has no USD conversion. PreStocks totals are “Portfolio Estimate” and position
  values are “Estimated Value.” Never show P&L, cost basis, or claim executable
  liquidation value.

Review against brief: avoid charts, performance statistics, feature-card grids,
generic token selectors, advanced routing controls, and automatic retries. Show a
compact set of required portfolio totals, the provider, readable prices, an
obvious path to asset details, and an equally clear connection status. A
keyboard-only user can operate every action; a mobile user receives the same
states without clipped controls.

References:

- Layout mechanism: https://github.com/changeroa/StyleGallery/blob/main/patterns/in-line-grouping/split-nav.md
- Dialog interaction mechanism: https://beui.dev/r/popover/raw
- Async action-state mechanism: https://beui.dev/r/button/raw
- Loading semantics reference (adapted to the no-motion system): https://beui.dev/r/loader/raw
- Asset investment layout mechanism: https://github.com/changeroa/StyleGallery/blob/main/patterns/split-sidebar/sidebar.md
- Multi-view dialog mechanism (adapted without motion): https://beui.dev/r/morphing-modal/raw
