# StockPilot UI redesign QA

## Architecture-correction revision — 2026-09-23

- Original orbital hero artwork, local optimized image, static landing generation.
- Header contains exactly two links: StockPilot home and **Open the app** (`/app`).
  No wallet, Markets or Portfolio header control. Existing app navigation stays intact.
- Positioning expanded to tokenized stocks; agent controls and xStocks explicitly
  marked in development. No fake agent actions or enabled public-stock category.
- Prior dashboard, Markets, detail and wallet styling preserved in this UI checkpoint.
- `pnpm test`: **102/102 passed** (47 core/domain, 23 auth/wallet/UI, 32 route/adapter).
- `pnpm build`: passed, including TypeScript; landing is now prerendered static.
- `pnpm validate:portfolio-read`: passed against public mainnet RPC.
- `pnpm validate:execution`: passed, 8 official PreStocks; 1 USDC quote through
  Meteora DLMM. This script is quote-only; no transaction execution occurred.
- Real browser: landing at 375, 768 and 1280px; no horizontal document overflow.
  Mobile/tablet artwork stacks below text. Live/planned panels, anchor navigation,
  PreStocks search and detail, and authenticated portfolio checked.
- Existing Phantom session remains signed in. Wallet dialog opens, Escape closes,
  and focus returns to its trigger. No new SIWS signature or purchase requested.
- Production server on 3001: artwork loads through `/_next/image`, header CTA
  reaches `/app`, expected disconnected portfolio state is shown in the separate
  browser, keyboard skip link has a visible outline, no browser warnings/errors
  observed, no react-grab/react-scan script present.
- React Doctor: 0 errors, 7 warnings in existing wallet/auth/portfolio/investment
  control-flow and effect patterns; score 71. No new hero/landing diagnostic.
  Security-sensitive lifecycle code was not refactored merely to clear warnings.
- Fresh Lighthouse medians and react-scan render-budget measurements were **not
  completed**. The permitted browser surface does not expose that audit recipe;
  no separate Playwright browser was launched outside it. The earlier score below
  is historical, not a result for this revision. Full performance certification,
  explicit 200% zoom and screen-reader testing remain open QA items.

## Historical UI checkpoint — 2026-09-22

## Delivered scope

Landing, shared desktop/mobile navigation, authenticated portfolio, searchable
Markets directory, asset detail, and wallet dialog styling. Reference research
used the public Paybox landing/sign-in pages, the user's permitted signed-in
dashboard, and the two supplied mobile screenshots. Design decisions live in
`docs/DESIGN.md`.

The BUY service, authorization checks, and signing/execution workflow are unchanged.
No transaction was signed or submitted during this UI work.

## Verification

- Full suite: 91/91 passed. Wallet and portfolio UI tests were rerun after their
  final markup/accessibility adjustments: 8/8 and 4/4 passed respectively.
- Production build: passed, including TypeScript and all app routes.
- Browser: inspected landing, Markets, asset detail, and portfolio at desktop and
  375px widths; additionally checked Markets at 768px, 1024px, and 1280px.
- Fixed Markets grid overflow after data/image loading and clipped columns at
  1024px. Document width and scroll width match in the checked layouts.
- Checked search submission, no-results copy, and Clear search recovery.
- The existing Phantom connection and StockPilot session remained available on
  localhost:3000. Wallet dialog opens, Escape closes it, and focus returns to its
  trigger. Keyboard focus styling and the skip link were observed.
- Production HTML contains no react-grab or react-scan scripts.
- Lighthouse mobile landing report: Performance 97, Accessibility 100,
  Best Practices 100, SEO 100. This is a single local run, not a site-wide
  accessibility certification. Windows denied removal of Lighthouse's temporary
  Chrome profile after the report was written; the report has no runtime error.
- React Doctor changed-file scan: one existing wallet control-flow complexity
  warning. Full scan also flags existing effect-based reads, hydration state,
  component exports, and investment workflow complexity. These were not expanded
  into a security-sensitive refactor during the visual update.

## Limits and follow-up

- Real mainnet investment acceptance remains outstanding; browser QA did not
  prepare, sign, or execute a purchase.
- No provider-backed historical series is available. Asset pages show current
  Token Price versus Mark Price, with explicit reference labels.
- Explicit 200% browser zoom and a screen-reader walkthrough were not completed.
- The temporary production QA server was stopped. The existing development server
  remains available, and the user's browser returns to localhost:3000/app with
  its normal viewport restored.

## Generated brand identity follow-up — 2026-09-23

- Generated a separate orbital-S logo with imagegen, preserving the selected master
  and prompt provenance. Shared BrandMark replaces both CSS bars and the auth `SP`
  placeholder; the old SVG favicon is replaced, recoverable in Git history.
- Exported ICO 16/32/48, browser PNG 48, Apple 180 and manifest icons 192/512.
  The initial ICO export exposed Next's RGBA-only PNG decoder requirement; fixed
  with an explicit alpha channel and covered by a regression assertion.
- `pnpm test`: 104/104 passed. Asset tests rerun after the RGBA correction: 2/2.
  `pnpm build`: passed after correction. `git diff --check`: passed.
- React Doctor: 71/100, seven existing warnings, zero errors. No warning in the new
  BrandMark or manifest. Authentication/investment behavior was not refactored.
- Browser: landing and signed-out app inspected at desktop and 375px; landing
  additionally checked at 768px. Mark loads at 32px/56px, remains recognizable,
  and no document overflow observed. Temporary viewport override reset.
- All seven icon/manifest/mark URLs return HTTP 200 with expected content types.
  Browser head references the new favicon, PNG icon, Apple icon and manifest.
- No wallet connection, signing or purchase was performed for this brand-only QA.
  No new Lighthouse/zoom/screen-reader certification is claimed.
