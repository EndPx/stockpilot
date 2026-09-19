# Phase 2 design foundation

Purpose: help users compare current PreStocks data and inspect one asset. The live
company table carries the page; there are no trading controls in this phase.

- Colors: background #F7F8FA, surface #FFFFFF, text #111318, secondary #6B7280,
  border #E7E9EE, restrained indigo #4F46E5 for links and actions.
- Type: system sans-serif, 16px body, 14px table labels, 32–40px page titles;
  tabular numerals for prices. No external font request.
- Layout: 1120px maximum width, left-aligned content, 24–48px section gaps.
  One white table surface, not a card for every value. Details use a definition list.
- Primitives: 12px surface corners, 8px controls, 44px minimum control height,
  visible indigo keyboard focus. Logos have text fallbacks.
- Responsive: 20px mobile gutters, scrollable data table with a visible label;
  detail statistics collapse to two columns. The document owns vertical scrolling.
- States: distinct loading, empty, no search results, unavailable, and not found.
  Token Price and Mark Price remain separate; missing data is an em dash.
- Motion: no decorative animation. Loading placeholders are static.

Review against brief: avoid portfolio statistics, feature cards, and transaction
controls. Show the provider, readable prices, and an obvious path to asset details.
