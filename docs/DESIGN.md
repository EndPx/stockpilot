# StockPilot interface contract

## 0. Research log

- 2026-09-23 revision: PayBox is a quality benchmark and control-plane research
  source, not a visual design to copy. StockPilot uses original text, geometry and
  generated artwork. Imagegen produced a metallic orbital navigation sculpture
  with charcoal negative space and cobalt core. A separately generated orbital-S
  logo replaces the earlier bar mark. Content order: hero, market scope,
  human-control flow, wallet security.
  Planned capabilities must be labeled and must not produce fake controls/dead links.
- 2026-09-22: reviewed the user's two mobile references. We take the dense market
  hierarchy, reachable bottom navigation, strong price typography, and persistent
  purchase action. We do not reproduce fictional performance, unsupported time
  series, or features that StockPilot does not yet have.
- Mechanism references: StyleGallery `cover`, `fixed-sidenav-shell`, `page-grid`,
  `reel`, and `supporting-pane`; BeUI button and tabs state mechanics.

## 1. Product and visual direction

StockPilot is an agent-native tokenized-stock product: cinematic before sign-in,
then quiet, precise, and operational inside the product. The signature is a warm
paper workspace with inset sidebar navigation and a vivid electric-blue
execution color. Financial data is dense but never theatrical.

Primary journeys are: understand the product, browse official PreStocks, inspect
one asset, connect and authenticate a Solana wallet, review the real on-chain
portfolio, and explicitly approve a BUY. Human authorization and source clarity
remain more important than decorative polish.

Must not have: copied Paybox assets/copy, fake P&L or historical charts, token
selectors, generic swap controls, sell/agent/rule controls that are not implemented,
automatic signing, automatic retries, or an interface that conflates wallet
connection with StockPilot authentication.

## 2. Tokens

- Canvas: warm paper `#f1f0ed`; elevated canvas `#f8f7f4`; surface `#ffffff`.
- Ink: `#11110f`; supporting ink `#6f6a64`; faint ink `#96918b`.
- Line: `#e4e1dc`; strong line `#d6d1ca`.
- Action: electric blue `#5468ff`; hover `#4053eb`; pale action `#eef0ff`.
- Success: `#168f5b`; warning: `#a15d10`; destructive: `#b93838`.
- Dark rail: `#11110f`; rail text `#f5f4f0`; rail-muted `#9c9891`.
- Landing art canvas `#070a0e`; security surface `#111319`; hero accent `#a5b0ff`,
  supporting text `#c0c3ca`, stage/caption `#a8aeb8`, link `#e1e3e8`.
- Market scope panels: private `#e9ecff` / ink `#24294a`; planned public `#eeede9`
  / ink `#373733` / border `#d8d7d2` / secondary `#686861`.
- Security text `#b9bdc7`, trust text `#bbbfc8`, mark `#aeb8ff`, checks `#8d9cff`.
- Surface radii: 24px major, 16px nested, 10px controls, full pills only for
  compact statuses. Shadows remain low contrast and broad, never neon glows.

## 3. Type and spacing

Use the local/system sans stack; do not make an external font request. Display
headings are 48–72px on the landing page and 32–44px in the app. Operational body
copy is 14–16px with generous line height. Financial figures use tabular numerals.
Use an 8px spacing base with 20px mobile gutters and 32–48px desktop section gaps.
Labels are sentence case; uppercase is reserved for short system kickers.

## 4. Layout and scroll ownership

- Landing: document-scroll cover. The hero occupies at least one viewport and
  contains original orbital artwork, not an artificial product screenshot. Desktop
  copy occupies the left 55%, artwork the right; on mobile artwork sits below copy.
  Header contains only the StockPilot home link and one `Open the app` action.
  No landing wallet control, Markets link or Portfolio link in the header.
  Display type is 52–96px desktop, 44–60px mobile; body copy remains legible over a
  dark image scrim. Decorative image has empty alt and responsive optimized output.
  Two editorial market-scope panels distinguish live PreStocks from planned xStocks.
- App desktop: fixed 248px navigation rail; the document owns vertical scrolling;
  content has a 1180px readable maximum and broad breathing room.
- App mobile: compact top bar plus fixed bottom navigation. The document still owns
  scrolling and receives safe bottom padding; no nested page scrollers.
- Markets: page-grid/list on desktop, compact market rows on mobile, with an
  optional horizontal reel for source-backed highlights.
- Asset: supporting-pane layout. Market facts and About are primary; the investment
  panel is sticky on wide screens and returns to document flow on narrow screens.

## 5. Components and states

Brand identity: use the generated white orbital-S/navigation mark on its opaque
cobalt tile, not the hero illustration or the former CSS bar mark. Shared BrandMark
renders at 32px (8px corner radius) in navigation/footer and 56px (16px radius) in
authentication. Keep the StockPilot wordmark as accessible HTML text. Export icons
directly from the preserved master: ICO 16/32/48, PNG 48, Apple 180, app 192/512.
Do not stretch, rotate, recolor, or add detail to the mark. The favicon silhouette
must remain recognizable at 16px; the arrow is secondary at that size.

Controls have at least 44px targets, visible blue focus rings, specific labels, and
`aria-current` on active navigation. Buttons define default, hover, focus, active,
disabled, and busy states. Dialogs keep backdrop/panel responsibilities separate,
contain focus natively, close on Escape when safe, and return focus to their trigger.

The wallet control must preserve pending, disconnected, connecting, connected,
disconnecting, reconnecting, no-wallet, and recoverable error states. Authentication
must independently preserve loading, signed-out, signing, authenticated, signing-out,
and recoverable failure states. A wallet switch never inherits another session.

Portfolio preserves loading, funded-empty, unfunded-empty, populated, expired
session, RPC failure, metadata failure, and unknown failure. Failed reads never
become zero balances. Portfolio figures remain estimates and holdings link to their
market details.

Markets preserves normal, searching, no match, no provider assets, stale cache,
and invalid input states. Token Price, Mark Price, and valuation remain separate.
Any visual comparison uses those actual fields and is labeled as a reference—not a
historical chart or executable quote.

Investment entry preserves disconnected, unauthenticated, incompatible wallet,
loading balance, invalid amount, insufficient balance, preparing, review, signing,
submitting, confirming, rejection, expired order, failure, and confirmed states.
`Approve in Wallet` is the only signing action. Success requires Jupiter execution,
shows actual input/output, links to Solscan, and refreshes the portfolio from chain.

## 6. Interaction and motion

Motion explains hierarchy only: 150–240ms color, opacity, and small transform
transitions for navigation, buttons, and expanding content. No looping decoration,
parallax, or animated market values. `prefers-reduced-motion` disables nonessential
transitions and transforms. Static skeletons are preferred to shimmer.

## 7. Responsive and accessibility acceptance

Validate at 375px, 768px, and 1280px, plus keyboard-only navigation and 200% zoom.
No horizontal document overflow. Mobile primary actions remain reachable above the
bottom navigation. Contrast targets WCAG AA; color never carries state alone.
Headings follow document order, market lists keep meaningful names and prices, full
wallet addresses remain available to assistive technology, and external links say
when they open a new tab.

## 8. Financial language and safety

USDC is `Available to Invest`; SOL is `Network Balance`; the aggregate is `Portfolio
Estimate`; positions use `Estimated Value`. PreStocks values are reference data, not
executable liquidation quotes. Never show cost basis, P&L, or shareholder rights.
State clearly that PreStocks exposure may not represent direct equity, voting rights,
or shareholder rights and that investing involves risk.

## 9. Verification and debt

2026-09-23: original generated hero shipped through Next Image with preload and
responsive WebP optimization. The landing is statically rendered and no longer
waits on the PreStocks API. Current browser QA covers 375/768/1280 widths. Full
Lighthouse mobile/desktop medians and react-scan render budgets remain unmeasured
in this revision; no 100-point quality certification is claimed. See UI-REDESIGN-QA.md.

Required closeout: unit tests, production build, React Doctor, real-browser checks
for landing/dashboard/markets/detail, keyboard focus, narrow/mid/desktop screenshots,
and verification that dev tools do not leak into production. Known acceptable debt:
StockPilot has no provider-backed historical series, so the asset detail uses a
truthful Token Price versus Mark Price reference visualization instead of a chart.
