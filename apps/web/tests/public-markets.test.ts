import assert from "node:assert/strict";
import test from "node:test";
import { createAssetsGet } from "../app/api/assets/route";
import { createMarketsGet } from "../app/api/markets/route";
import { parseMarketInputs, marketHref } from "../lib/market-inputs";
import { activeNavigationSection, marketSectionLabels } from "../lib/market-navigation";
import { RegistryQueryError } from "@stockpilot/core/asset-registry";

test("public discovery API has bounded filters and no authentication or execution side effects", async () => {
  const get = createMarketsGet(async (filter) => {
    assert.equal(filter?.provider, "xstocks"); assert.equal(filter?.limit, 10);
    return { assets: [], total: 0, catalogTotal: 1026, offset: 0, nextCursor: null, sources: [], stale: false };
  });
  const response = await get(new Request("http://localhost/api/markets?provider=xstocks&limit=10"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).catalogTotal, 1026);
});
test("invalid market requests return 400 before provider reads; outages remain 503", async () => {
  let calls = 0;
  const get = createMarketsGet(async () => { calls++; throw new Error("private upstream diagnostic"); });
  for (const query of ["limit=1000", "limit=1e2", "q=a&q=b", "provider=unknown", "group=crypto", "marketType=PRE_IPO&marketType=ETF"]) assert.equal((await get(new Request(`http://localhost/api/markets?${query}`))).status, 400);
  assert.equal(calls, 0);
  const outage = await get(new Request("http://localhost/api/markets"));
  assert.equal(outage.status, 503); assert.doesNotMatch(await outage.text(), /private upstream/);
  const invalidCursor = createMarketsGet(async () => { throw new RegistryQueryError("Invalid cursor."); });
  assert.equal((await invalidCursor(new Request("http://localhost/api/markets?cursor=bad"))).status, 400);
});
test("market navigation keeps query/filter while resetting cursors", () => {
  assert.deepEqual(marketSectionLabels, { private: "Pre-IPO", public: "Stocks" });
  assert.equal(marketHref(parseMarketInputs({ q: "NVIDIA", group: "public", cursor: "old" })), "/markets?q=NVIDIA&group=public");
  assert.equal(activeNavigationSection("/markets", null), "private");
  assert.equal(activeNavigationSection("/markets", "private"), "private");
  assert.equal(activeNavigationSection("/markets", "public"), "public");
  assert.equal(activeNavigationSection("/markets/POLYMARKET", null), "private");
  assert.equal(activeNavigationSection("/markets/xstocks/canonical-mint", null), "public");
  assert.equal(activeNavigationSection("/app", null), "overview");
  assert.equal(activeNavigationSection("/wallet", null), "wallet");
  assert.equal(activeNavigationSection("/credentials", null), "wallet");
});

test("the Markets asset API remains public without an authentication cookie", async () => {
  const seen: string[] = [];
  const get = createAssetsGet(async (query) => {
    seen.push(query ?? "");
    return {
      assets: [],
      total: 0,
      meta: { fetchedAt: new Date(0).toISOString(), stale: false },
    };
  });

  const response = await get(new Request("http://localhost:3000/api/assets?q=space"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(seen, ["space"]);
  assert.deepEqual(await response.json(), {
    assets: [],
    meta: { fetchedAt: new Date(0).toISOString(), stale: false },
  });
});
