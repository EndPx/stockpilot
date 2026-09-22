import assert from "node:assert/strict";
import test from "node:test";
import { createInvestmentPreparePost } from "../app/api/investments/prepare/route";
import { createInvestmentExecutePost } from "../app/api/investments/execute/route";

test("financial routes default disabled before auth, body reads or upstream calls", async () => {
  const previous = process.env.INVESTMENTS_ENABLED;
  delete process.env.INVESTMENTS_ENABLED;
  try {
    const prepare = createInvestmentPreparePost({ prepare: async () => { throw new Error("must not call provider"); } });
    const execute = createInvestmentExecutePost({ execute: async () => { throw new Error("must not call provider"); } });
    for (const post of [prepare, execute]) {
      const response = await post(new Request("https://stockpilot.test/api/investments", { method: "POST", body: "malformed" }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "INVESTMENTS_DISABLED");
    }
  } finally {
    if (previous === undefined) delete process.env.INVESTMENTS_ENABLED;
    else process.env.INVESTMENTS_ENABLED = previous;
  }
});
