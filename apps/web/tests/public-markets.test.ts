import assert from "node:assert/strict";
import test from "node:test";
import { createAssetsGet } from "../app/api/assets/route";

test("the Markets asset API remains public without an authentication cookie", async () => {
  const seen: string[] = [];
  const get = createAssetsGet(async (query) => {
    seen.push(query);
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
