# StockPilot interface contract

## 0. Research log

- 2026-09-23 revision: PayBox is a quality benchmark and control-plane research
  source, not a visual design to copy. StockPilot uses original text, geometry and
  generated artwork. Imagegen produced a metallic orbital navigation sculpture
  with charcoal negative space and cobalt core. A separately generated orbital-S
  logo replaces the earlier bar mark. Content order: hero, market scope,
  human-control flow, footer. The standalone "Built on trust" section was removed
  at the user's request; transaction safeguards remain unchanged.
  Planned capabilities must be labeled and must not produce fake controls/dead links.
- 2026-09-22: reviewed the user's two mobile references. We take the dense market
  hierarchy, reachable bottom navigation, strong price typography, and persistent
  purchase action. We do not reproduce fictional performance, unsupported time
  series, or features that StockPilot does not yet have.
- Mechanism references: StyleGallery `cover`, `fixed-sidenav-shell`, `page-grid`,
  `reel`, and `supporting-pane`; BeUI button and tabs state mechanics.
- 2026-09-25 Overview revision: the supplied PayBox screenshot informs the
  two-up Activity/Agents summary and full-width wallet summary. StockPilot keeps
  its original graphite/cobalt system, its one verified Solana wallet, and only
  source-backed balances and server-recorded events.

## 1. Product and visual direction

StockPilot is an agent-native tokenized-stock product: cinematic before sign-in,
then quiet, precise, and operational inside the product. The signature is a cool
graphite workspace with inset sidebar navigation and a vivid electric-blue
execution color. Financial data is dense but never theatrical.

Primary journeys are: understand the product, browse official PreStocks and xStocks, inspect
one asset, sign in through Privy, inspect the verified Solana wallet and real
on-chain portfolio, connect an AI host to StockPilot via browser OAuth when
configured, review agent access in Settings, review investment requests, and
inspect activity. Human authorization and source clarity
remain more important than decorative polish.

Must not have: copied Paybox assets/copy, fake P&L or historical charts, token
selectors, generic swap controls, sell/agent/rule controls that are not implemented,
automatic signing, automatic retries, or an interface that conflates wallet
connection with StockPilot authentication.

## 2. Tokens

- Canvas: orbital charcoal `#070a0e`; elevated canvas `#0e131b`; surface `#141b25`.
- Ink: silver `#eef2f8`; supporting ink `#a6b1c2`; faint ink `#8a98ad`.
- Line: `#293444`; strong line/control boundary `#61728a`.
- Brand cobalt `#5468ff`; action fill `#4c60f0` (darker for white-label contrast);
  hover `#4053eb`; pale action `#1c2947`.
  Action text/focus: `#a5b0ff`, distinct from the darker white-text button fill.
- Success: `#64dba2`; warning: `#f2ca80`; destructive: `#ffaba7`.
  Success background `#102b25`; warning `#302617`; destructive `#331e25`.
- Dark rail: `#0b1017`; hover surface/skeleton `#202d3e`; inverse ink `#101620`.
- Background material: landing uses a restrained cobalt light (12% opacity)
  beneath the hero and a charcoal fade into the editorial sections. Dashboard uses
  solid charcoal, with opaque panels and a subtle silver inner rim. No starfield,
  animated glow, repeated hero image, or gradients behind financial text.
- Accent hover surface `#293b60`; logo fallback ink `#475569` on white issuer tiles.
  White issuer tiles intentionally retain their original artwork contrast. Selection
  uses `#cdd3ff` and inverse ink. Subdued labels are slate rather than cobalt in app.
- Landing art canvas `#070a0e`; security surface `#111319`; hero accent `#a5b0ff`,
  supporting text `#c0c3ca`, stage/caption `#a8aeb8`, link `#e1e3e8`.
- Market scope panels: private `#18253f` fading to `#101823`, public discovery
  surface `#141b25`; both use silver ink and muted slate body copy.
- Security text `#b9bdc7`, trust text `#bbbfc8`, mark `#aeb8ff`, checks `#8d9cff`.
- Surface radii: 24px major, 16px nested, 10px controls, full pills only for
  compact statuses. Shadows remain low contrast and broad, never neon glows.

## 3. Type and spacing

Use the local/system sans stack; do not make an external font request. Display
headings are 48–72px on the landing page. The signed-in app uses a distinct,
compact operational scale informed by the observed PayBox dashboard hierarchy:
28px page title (26px mobile), 16px section heading, 14px navigation,
13px supporting copy, 12px metadata, and 26–28px primary financial figures. Wallet public
addresses stay at 13px monospace, wrapping rather than truncating on narrow
screens. Market row product names remain 14px and data 12–14px. Never shrink
interactive targets below 44px or reduce contrast to achieve density. Financial
figures use tabular numerals. Use an 8px spacing base with 20px mobile gutters;
the app's repeated panels use 16–20px internal padding and 16–20px gaps, while
the landing retains broader editorial spacing.
Labels are sentence case; uppercase is reserved for short system kickers.

## 4. Layout and scroll ownership

- Sign-in (Privy migration): the document owns scrolling. At wide widths, a
  38/62 split places an original orbital-art editorial panel beside a quiet
  authentication panel; the form stays within a 430px measure. At narrow widths,
  the visual panel becomes a short brand masthead above the form. Neither pane
  creates a nested scrollbar. The PayBox reference informs composition only,
  never photography, logo, or copy.

- OAuth connection handoff (2026-09-25): use a standalone document-scrolling
  `/connect` page, not the operational sidebar. The original StockPilot brand
  sits in a quiet top bar above a centered, at-most-600px consent summary.
  The user's PayBox screenshot informs the clear wallet/access hierarchy and
  single primary action, not its white palette, logo, copy, or unsupported
  controls. On mobile, the same summary occupies the page width with 20px
  gutters and no nested scrolling. The client name is not asserted until
  WorkOS displays its verified OAuth consent; the temporary auth ID never
  appears as visible page copy.

- Landing: document-scroll cover. The hero occupies at least one viewport and
  contains original orbital artwork, not an artificial product screenshot. Desktop
  copy occupies the left 55%, artwork the right; on mobile artwork sits below copy.
  Header contains only the StockPilot home link and one `Open the app` action.
  Header stays fixed to the viewport during document scrolling and is fully
  transparent: no background fill, backdrop blur, border or shadow. Only the
  logo/wordmark and `Open the app` control remain visible. Existing hero
  padding reserves space; document anchor/focus scroll padding is 112px desktop
  and 96px mobile so destinations are not hidden behind the persistent header.
  No landing wallet control, Markets link or Portfolio link in the header.
  Display type is 52–96px desktop, 44–60px mobile; body copy remains legible over a
  dark image scrim. Decorative image has empty alt and responsive optimized output.
  Two editorial market-scope panels distinguish Pre-IPO (sourced from PreStocks)
  from Stocks (live xStocks discovery). Public execution remains unimplemented.
- App desktop: fixed 248px navigation rail; the document owns vertical scrolling;
  content has a 1320px maximum for dense data panels, while prose inside panels
  retains a narrower readable measure. The account
  capsule is anchored at the rail bottom; its disclosure opens upward within
  the rail and creates no nested scrollbar (StyleGallery fixed-sidenav-shell +
  anchored overlay pattern). The email truncates within the capsule, while its
  full value is available in the disclosure.
- App mobile: compact top bar plus fixed bottom navigation. The document still owns
  scrolling and receives safe bottom padding; no nested page scrollers. Bottom
  navigation has Overview, Pre-IPO, Stocks, Agents, and a More disclosure for
  Wallet, Approvals, and Activity in Privy mode; legacy mode keeps its three
  destinations. Every target is at least 44px. The account disclosure opens below the mobile header, never
  underneath the fixed navigation.
- Overview and Wallet revision (2026-09-25): the document alone scrolls. A
  roomy page-grid places a wider seven-day Activity panel beside a narrower
  connected-Agents panel, followed by a full-width Wallet summary. At constrained
  widths the panels stack in that source order. Activity bars use exact UTC daily
  server counts; approval events are a separate segment and each day has a text
  equivalent. No activity, provider failure, and loading are different states.
  Agents lists only real active clients with truthful connection/last-use labels.
  The Wallet summary shows the server-verified primary Solana address and real
  portfolio estimate when available; an RPC/provider failure never becomes $0.
  The full address, Portfolio Estimate, Available to Invest, Network Balance, and
  Investments/positions live together on the dedicated Wallet page. No fake EVM
  wallet or "New credential" control is inferred from the PayBox screenshot.
- Markets: page-grid/list on desktop, compact market rows on mobile, with an
  optional horizontal reel for source-backed highlights.
- Asset: supporting-pane layout. Market facts and About are primary; the investment
  panel is sticky on wide screens and returns to document flow on narrow screens.

## 5. Components and states

Manual trade feedback revision (2026-09-25): submitted trades show a quiet,
announced "Confirming on Solana…" status, followed by "Trade complete" only
after verified settlement. Receipt checks run automatically with bounded requests
and backoff; there is no Check trade status button and no transaction resubmission.
Unknown, failed, rejected, and needs-review states remain distinct. New trades stay
blocked while an outcome is unresolved. The trade footer no longer repeats the
old test-wallet balance warning; exact amounts, fees and wallet signing remain
in the review. Sell balance uses the same authenticated portfolio source as Wallet,
refreshing on Sell selection, return to the tab, and settlement. Loading and failed
reads never become zero; Use holding copies exact base-token units without rounding.
For scaled xStocks, wallet display quantity and sellable base-token units are labeled
separately. Existing typography, buttons, focus and status primitives are reused.
The BeUI action-swap mechanism informs state labels in place; no new motion/library
is needed and feedback stays static under all motion preferences.

Delegated agent execution revision (2026-09-26): the connected-agent detail
has one Policy surface and one Edit policy entry point. The Wallet actions view
contains both wallet automation permission and execution grants; Read & requests
contains the independent read/request policy. The selected view saves through its
own versioned endpoint, never an implied combined save. Save or cancel before
switching views so drafts are not silently discarded. BUY, SELL, transfer SOL, and
transfer USDC are four independent opt-ins; new clients start with every execution
permission off. The panel uses existing
Surface, control-form, fieldset, button, and ConfirmDialog primitives, without
changing the two-column layout or document scroll ownership. A saved policy
alone does not connect wallet signing: the inline Wallet automation fieldset in
Edit policy requires its own explicit user action and server-verified readiness.
The summary shows readiness without grant controls. Explain that wallet delegation
is shared across agents but each agent's own policy limits its actions; cancelling
draft edits does not undo an already-confirmed wallet permission. Never claim a
policy save, OAuth reconnect, or legacy approval request executed a transaction.
Before an enabled automation policy is saved, the themed confirmation names
the agent and selected actions and states that those actions can run without
per-transaction approval. Cancellation sends no mutation. Show exact human-unit
limits for each operation and rolling 24 hours, with explicit Unlimited choices;
BUY/USDC use USDC, SOL uses SOL, and SELL limits name their individual token.
Eligible assets are the supported canonical Polymarket PreStocks and AAPLx
products, not a generic all-market grant. Transfers require a visible recipient
allowlist or an explicit Any recipient choice. Expiry and Indonesia/non-U.S.
investor/issuer-risk acknowledgments are owner inputs, never inferred from login.
Loading, unavailable, saved, conflict, invalid input, expired policy, inactive
client, and wallet-not-connected states remain distinct. Revoked/expired clients
cannot edit grants; disabling a grant affects future signing, not an already
submitted transaction. Existing request-policy language must not imply either
global trading disablement or wallet authority. This revision supersedes earlier
unavailable-only automatic-execution copy only where the new enforced controls
are present. Visual/browser accessibility verification is required separately;
unit tests do not constitute a visual or performance certification.

Privy sign-in extension: a dedicated `/sign-in` surface uses the existing
BrandMark, charcoal/navy and cobalt system. The credential choice card has a
Google primary action and email fallback using the Privy modal. The email field
prefills the real Privy flow, not a parallel StockPilot password form. Buttons
retain 44px targets and idle, busy, disabled and error states. If Privy is not
configured, show a truthful unavailable state rather than a dead submit button.
In Privy mode, direct visits and client navigation to Overview, Wallet,
Pre-IPO, Stocks and asset details require an active server
  session. Unauthenticated or expired sessions redirect to `/sign-in` with a
validated same-site return path. Landing and sign-in remain public; read-only
market APIs retain their separate public contract. A temporary session-store
failure fails closed with an unavailable response, not a misleading login loop.
After login, show the user-owned embedded Solana address and explain that it is
new and separate from any previous Phantom address. No transfer, agent grant or
transaction is triggered by signing in. Keep manual/agent trading disabled until
their separate migration and acceptance gates pass.

Privy account and wallet revision (2026-09-25): the rail-bottom capsule
uses the user's actual Google/email identity with a compact initial tile and
chevron. Its disclosure states the full signed-in identity, links to the
Wallet view, and offers Sign out; there is no nonfunctional “Sign in on
mobile” action. The same account control is compact in the mobile header.
The Wallet page is a read-only wallet identity and portfolio, not a vault: one server-verified
primary Solana wallet, its full public address, copy action, mainnet label, and
explorer link, real balance metrics, and investments. Never provide reveal/export
private key, agent grant, funding claim, or a fake EVM wallet. Overview repeats
the same wallet identity and estimate, including when RPC balances are unavailable. The wallet
address is taken from the StockPilot server session, not from client-supplied
identity. Copy feedback is announced to assistive technology. The disclosure
has closed/open, focus, long-email, mobile and signing-out states; wallet
identity has loading, authenticated, unavailable, copied and copy-failure
states.

Agent control plane extension (2026-09-23): retain the compact graphite shell.
Desktop rail includes Agents, Wallet, Approvals, and Activity as operational
destinations. Agents lists named clients, their type, active/revoked state, last
use and policy. Existing bearer credentials belong to Agents, not Wallet; they
appear only as masked summaries, and rotation/revocation require confirmation.
No live key goes
in a URL or browser storage. Approvals separates pending from decided requests;
detail shows client, canonical asset/mint, USDC amount, policy snapshot,
deadline, and clear Approve/Reject. Approve records consent only: no wallet
signature, order preparation or execution occurs. Activity gives actor, event,
client, related request and timestamp. All views distinguish loading, empty,
error, and ready states; mutation controls distinguish idle, busy, success and
failure. A failed load is never represented as an empty list. Financial execution
remains off in production until a separately reviewed and accepted gate.

Overview primitives (2026-09-25): the Activity preview has loading, seven-day
empty, ready, and retryable error states. The exact UTC count is backed by an
owner-scoped database aggregate; bars have an accessible daily text equivalent.
Each day in a nonempty week is an inspectable, full-height target, including
zero-count days. Hover or keyboard focus previews its exact UTC date, total,
Activity count, and Approvals count in a stable in-card readout; tap/click pins
that day until another day is chosen. Each target's accessible name contains
the same counts, and focus remains visible. The readout does not invent event
details or trigger a new request. It stays within the clipped surface rather
than relying on an overflow-prone floating tooltip. Below 440px, the seven-day
plot becomes seven compact day rows so every tap target remains at least 44px.
The Agents preview has loading, no-connected-agent, ready and retryable error
states and links each real client to its detail page. The Wallet preview repeats
only the verified public Solana address and truthful estimate, with loading and
retryable balance-error states; it never repeats investment positions or agent
keys. Wallet itself contains the address, balance summary, and Investments with
independent RPC/provider failure handling. Existing bearer keys remain rotatable
and revocable under Agents, never shown on Wallet.

Agent OAuth onboarding revision (2026-09-25): the Agents page is the single
entry for new AI-host connections. It checks server-reported OAuth readiness
before showing host-specific instructions and the HTTPS MCP endpoint. When OAuth
is not configured, show an explicit unavailable state, never a copyable
"connect now" route or a false connected state. When available, guide ChatGPT,
Claude and Codex through their host's custom MCP setup: add the StockPilot URL,
start the host's OAuth flow, authenticate in the browser, then return to that
host. Copying a URL does not connect an agent. There is no manual New Client form,
client type selector, limit form, or static bearer issuance in the new connection
path. The existing client list remains the source of connected/revoked records;
legacy keys remain manageable in Agents for compatibility, with no new key
issuance through the UI. Agents has distinct readiness loading, unavailable,
ready, copy-success/error, policy-loading/error and revoked states. Connection
instructions are not a substitute for verified OAuth and do not show a token.
The connector guide is one reusable panel: a 44px-or-taller host selector, a
single selected-host instruction region, the server-provided URL in a wrapping
read-only field, and a labeled copy control. It has idle, selected, copied,
copy-error, readiness-loading and readiness-unavailable states. Selection uses
the existing cobalt active surface; copy feedback changes text in place and is
announced through a status region. No extra animation library is introduced;
existing 150–240ms color transitions and reduced-motion rules apply.

OAuth handoff page revision (2026-09-25): after the WorkOS Login URI verifies
the active Privy session, it redirects to `/connect` before completing external
authentication. The page shows only the server-session primary Solana wallet,
states that *new* agents start with market-read access, warns that an existing
client's previously elevated policy survives reconnection, and has one
`Continue with WorkOS` action. It must not expose a wallet selector, editable scope, spending limit,
or expiry options until those choices are enforced by signed OAuth claims and
durable owner-scoped policy. WorkOS retains its own consent screen and the final
PKCE/loopback callback. The page has ready, invalid/expired request, signed-out,
and unavailable states; submission is same-origin, short-lived, session-bound,
and bounded. Its CSP allows only the configured AuthKit origin for the ensuing
form redirect; other pages retain `form-action 'self'`.
Focus and hover follow existing cobalt 150–240ms transitions; reduced-motion
removes nonessential transforms. This is an authorization handoff, not a grant
on its own, and it must never claim an agent is connected before a verified
MCP token reaches the control plane.

Agent settings revision (2026-09-25): an authenticated owner may open Settings
for an existing client. Read scopes are individually selectable; investment
requests are separately selectable and, while execution is disabled, always
require human approval. BUY auto-execution and SELL are described as unavailable,
not rendered as operable toggles. Per-request and 24-hour request limits live in
Settings, not onboarding. An explicit, separately acknowledged "No limit" choice
maps to the server's nullable request cap; the UI must not imply it authorizes
execution. Versioned policy saves show conflict and error responses rather than
silently overwriting another edit. An existing approval remains consent only:
there is no wallet signature or execution until a separate reviewed backend gate.
The policy editor is a reusable panel with read-scope checkboxes, a separate
request permission, two numeric request caps with explicit unlimited checkboxes,
and one save action. Controls have default, focus, disabled, busy and error
states. The current policy version stays visible and read-only. A revoked client
never shows an editable policy. Permission labels must name outcomes, not only
technical scope strings, so read-only and approval-required users can understand
what an agent can actually do.
Quick choices may select Read only, Request only, or Read + request; the latter
two mean an approval request, not an executable write. Custom per-scope changes
remain possible and may leave no quick choice selected.

Control-plane confirmation revision (2026-09-25): policy cap removal,
agent revocation, approval decisions, and legacy-key rotation/revocation use
one themed native-dialog primitive rather than browser `confirm()`. The dialog
names the exact consequence and target, puts Cancel first and focuses it on
open, traps focus through `showModal()`, supports Escape while idle, and returns
focus to the trigger or a stable replacement after a completed mutation.
Cancellation never sends a request. During a mutation, both actions are
disabled and the dialog stays open until the outcome is known. The destructive
variant uses the existing danger token; both themes keep 44px targets and a
separate backdrop. Removing a request cap never implies wallet-signing or
automatic execution authority.

Connected-agent detail revision (2026-09-25): each row in Agents opens an
owner-scoped `/clients/[id]` detail page. Use the existing compact graphite
system and document scroll, with a back link, clear agent identity/status,
connection method, creation/last-use and client-level expiry metadata. The
main surface groups *actual* StockPilot policy scopes under granted access;
read permissions and approval-required investment requests remain visibly
distinct. Show request caps only as request caps, never as spending authority.
`Edit policy` reveals the existing versioned policy editor on this page;
revoked or expired clients have read-only detail and no save action. Recent
activity is filtered server-side to this client and has separate loading,
empty, and error states. On wide screens, a supporting-pane grid places policy
and its destructive secondary action in the wider left column and Recent
activity in the narrower right column, directly below the full-width identity
metadata. The document remains the only scroll owner; neither panel gets an
internal scrollbar. Below the two-column content threshold, the DOM order
stacks policy, revoke, then activity without changing keyboard focus order.
Long activity labels and timestamps wrap within the pane. Revoke is a confirmed,
destructive secondary action.
The PayBox reference contributes information hierarchy, not its branding,
signing-key control, EVM/card/secret grants, autonomous labels, or swap
slippage controls, none of which StockPilot implements. Do not describe a
client-level `NULL` expiry as a non-expiring OAuth token. The detail page stacks
cleanly at mobile widths with 44px action targets and no internal page scroll.

Connected-agent directory revision (2026-09-25): below the existing host
connection choices, show a standalone "Agents" heading with the count of
clients that are both active and have an authentication method. Keep a quiet
Refresh action so a newly authorized MCP client can appear without a reload.
Repeat real client records as compact, left-aligned cards rather than one
full-width row or a nested panel. Each card has an explicit active/revoked/
expired state, name, connection method, abbreviated non-secret client ID,
saved-permission count, truthful last-use text, a Details link and, only when
active, a confirmed Revoke action. No manual Create client action or PayBox key
prefix is copied from the reference. Revoked and expired cards remain visible
but do not count as active. Cards use the established surface, ink and focus
tokens in both themes; [StyleGallery card-grid](https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/card-grid.md)
supplies fluid repetition and [line-up](https://github.com/changeroa/StyleGallery/blob/main/patterns/stacking/line-up.md)
keeps actions aligned. The document alone scrolls; at narrow widths cards
become a single column with at least 44px action targets. Revocation has
confirming, busy, success/refresh and retryable error states.

Control-plane navigation/theme revision (2026-09-23): in Privy mode the desktop
rail groups Overview, Wallet, Agents, Approvals, Activity before market
discovery. The app has a two-state Light/Dark theme control in the rail and
mobile header. Dark remains the default; a user's explicit choice persists in
local storage and applies before first paint on later visits. The theme only
changes the authenticated app shell, leaving the orbital landing and sign-in
unchanged. Light app tokens: canvas `#f4f6fa`, raised `#eef2f7`, surface `#fff`,
ink `#18212f`, muted `#526174`, faint `#64748b`, line `#dce3ec`, strong line
`#9aa9ba`, rail `#f9fbfd`, hover `#e9eef7`, pale cobalt `#e8ecff`, accent text
`#354ccc`, success `#176a4f`, warning `#80550c`, danger `#b6363e`. Surfaces keep
the same radius and a low-contrast, broad shadow. Theme control has focused,
pressed, and announced states, with no decorative page-cover animation. Because
the document owns vertical scrolling, its native scrollbar uses the active app
color scheme; the landing, sign-in, and OAuth handoff remain dark even when a
light app preference is saved. Agents shows only host connection paths supported
by the configured OAuth service;
legacy bearer setup is not offered as a new-client path. Approvals keeps pending/decided
filters and links to the full request review; an empty list never claims a trade
occurred. The obsolete Phantom migration paragraph is removed from Wallet.

During first Google sign-in, “authenticated” can precede automatic embedded
Solana wallet provisioning. Show a truthful finishing state while a bounded
wallet-only wait completes. If provisioning still has not finished, show a
specific recoverable message rather than “authentication request invalid”. Do
not apply automatic retry to investment preparation or execution.

Historical chart extension (2026-09-23): public xStocks and private PreStocks
details share a quiet, source-backed token-price surface before the existing facts.
Use a straight SVG close-price line, no curve smoothing, fill, glow or animation.
Time is proportional on the horizontal axis; missing intervals break the line.
Only completed candles appear. The 1D / 1W / 1M controls use the existing 44px
button targets, cobalt selected state and BeUI controlled-selection mechanics;
1M means 30 days. Candle inspection happens directly on the focusable plot through
mouse hover, touch/pen tap, or Arrow/Home/End keys; there is no separate visible range bar.
Show the selected close, UTC interval end, USD axis, actual-period change, fetched
time and linked pool/source attribution. An expandable semantic close-price table
provides the same data without requiring vision or pointer use.
Show both USD and percentage movement across available closes, labeled as a DEX
pool move for the selected period. On public detail pages, keep the issuer's
indicative token quote in the hero as the primary reference; the chart remains
visibly separate and must not imply the two price series are interchangeable.
Keep 24px padding (18px on mobile), tabular figures, a 220px plot, and existing
surface/ink/muted/line/cobalt tokens. Empty, loading, provider failure, partial/gapped
history and omitted ambiguous candles are explicit, not fabricated flat lines.
Charts describe a single DEX pool's token prices, never underlying stock prices,
private-company valuations, execution quotes or trading eligibility. The PreStocks
issuer's Token/Mark Price comparison stays separate. Fetch only on detail navigation,
range selection or explicit retry; no background polling or external browser scripts.
The heading is explicitly `DEX-reported price`, with a prominent 12px unit notice
between controls and figures on the elevated-canvas surface. Provider units are
not proven normalized for splits/multipliers and must not be equated to issuer
quotes or wallet display amounts. Do not apply today's multiplier to historical
candles or label the percentage as split-adjusted investment performance.

Discovery extension (2026-09-23): retain the existing shell, colors and controls.
Markets uses a bounded server-rendered directory (30 rows), with a labeled search
form, result count and next / first-page links. The rail and mobile destinations
reuse 44px-or-taller targets, cobalt active surface and visible focus. Cursor resets
when query/group changes. Loading, provider
failure, invalid query/cursor, stale data and no-match states must remain explicit.
Do not render a heavy 1,000-card grid or auto-fetch eligibility for catalog rows.
Public details reuse the asset identity, stats, token-details and surface primitives,
but have a read-only discovery panel instead of investment controls. Execution
"Not checked" is neutral text, never a green readiness badge. Mobile must retain
symbol and status even when secondary classification columns collapse; the page
heading and source note retain provider attribution.
The market title and source note carry issuer attribution; individual rows show
the product name and ticker without repeating PreStocks or xStocks. The source
remains available on each detail page. Use 16/24px panel padding, 8/16px gaps,
14px row text and the existing surface tokens.
Product copy distinguishes live public discovery from unimplemented public execution
and future agents. Both market-scope panels may link to their live filtered catalogs.

Market navigation revision (2026-09-23): replace the in-page All/Private/Public
switcher with separate Pre-IPO and Stocks rail/bottom destinations. These are
the user-facing names; `private` and `public` remain stable internal group keys.
Plain `/markets` opens Pre-IPO to avoid making the eight-asset private
journey wait on the large public catalog. Each page title, count, search form,
pagination and empty/loading copy names its current source. Keep the established
30-result keyset pagination and official provider identity checks. Active navigation
follows query group on the directory and provider on asset details. Public catalog
refresh may serve its previously verified snapshot for at most 30 minutes while a
single background refresh runs; mark it as cached, never as fresh. A cold public
fetch still needs all upstream pages and keeps the loading state truthful.

Market transition feedback (2026-09-23): both Pre-IPO and Stocks links
show immediate, centered pending feedback while an unprefetched navigation waits;
the route's Suspense fallback continues the same feedback while catalog data
streams. Use the existing cobalt/line tokens for one 40px spinner and a short
"Loading markets" label, not a fabricated percentage or shimmer. Center the
indicator in the available main-content viewport (StyleGallery super-center);
the document remains the only scroll owner and the rail/mobile navigation
remains usable. The spinner rotates using transform only. Reduced-motion mode
uses a calm opacity pulse, with the visible label and an accessible status
announcement present regardless of animation.
Opening a private or public asset row uses the same centered spinner immediately
while unprefetched navigation waits, then the same route-level fallback until
the asset page renders. Its label identifies the pending asset detail. No fake
price or skeleton figures appear during this transition.

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

Market directory table revision (2026-09-23): the supplied PreStocks screenshot
sets the information hierarchy, not the palette. Use a semantic table with one
product per ruled row, 44px issuer logo, readable product name and ticker,
tabular issuer values, truncated Solana address with a labeled copy control,
an optional issuer Information link, and a cobalt Explore action to internal
details. Pre-IPO columns are Product, Token price, Implied valuation, Mark price
with premium, Mark valuation, Address and actions. Premium means
`(token price / mark price − 1) × 100`; show it only for two valid positive issuer
prices and label it as a comparison, not daily performance. Stocks use the same
row primitive but show only their available issuer quote, classification,
underlying symbol, address and actions; do not invent mark/valuation fields.
At narrow widths, each row reflows into a compact card with product, main price,
mark comparison where available, and the Explore action. Secondary valuations and
address move to the detail page rather than causing horizontal document scroll.
At intermediate widths (560–780px of directory space), that compact row stays
horizontal: product, reference price, mark comparison when present, and actions
share one line instead of creating tall, sparse cards. At phone widths, the
two-column stacked card remains readable and touch targets stay 44px high.
The document remains the only scroll owner. Empty, stale and unavailable states
continue to use the directory's existing copy and controls.

Investment entry preserves disconnected, unauthenticated, incompatible wallet,
loading balance, invalid amount, insufficient balance, preparing, review, signing,
submitting, confirming, rejection, expired order, failure, and confirmed states.
`Approve in Wallet` is the only signing action. Success requires Jupiter execution,
shows actual input/output, links to Solscan, and refreshes the portfolio from chain.
The Privy manual-BUY implementation reuses this existing review surface and its
states. Wallet discovery must select exactly the server-session Solana address,
never the first connected wallet. While the Privy execution kill switch remains
closed, the production detail page continues to show the truthful read-only panel;
no inactive BUY control is shown.

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

2026-09-23 background revision: remove the warm-paper break between the orbital
artwork and the rest of the product. Keep existing geometry, generated art, content,
wallet lifecycle and execution behavior. Validate labels and controls on dark
surfaces, including empty/loading/error states, not only the hero screenshot.

2026-09-23: original generated hero shipped through Next Image with preload and
responsive WebP optimization. The landing is statically rendered and no longer
waits on the PreStocks API. Current browser QA covers 375/768/1280 widths. Full
Lighthouse mobile/desktop medians and react-scan render budgets remain unmeasured
in this revision; no 100-point quality certification is claimed. See UI-REDESIGN-QA.md.

Required closeout: unit tests, production build, React Doctor, real-browser checks
for landing/dashboard/markets/detail, keyboard focus, narrow/mid/desktop screenshots,
and verification that dev tools do not leak into production. Historical coverage is
limited to matching, source-verified DEX pools; unsupported assets and provider rate
limits remain honest empty/error states. Token/Mark Price reference comparisons are
not substituted for historical data. Full Lighthouse medians remain unmeasured.
