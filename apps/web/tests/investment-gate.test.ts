import assert from "node:assert/strict";
import test from "node:test";
import { createInvestmentPreparePost } from "../app/api/investments/prepare/route";
import { createInvestmentExecutePost } from "../app/api/investments/execute/route";

test("financial routes default disabled before auth, body reads or upstream calls", async () => {
  const previous = process.env.INVESTMENTS_ENABLED;
  delete process.env.INVESTMENTS_ENABLED;
  try {
    const prepare = createInvestmentPreparePost({ prepare: async () => { throw new Error("must not call provider"); } });
    const execute = createInvestmentExecutePost({ executeManual: async () => { throw new Error("must not call provider"); } });
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

test("Privy manual trading flag permits route entry but still requires a verified session", async () => {
  const names = ["NEXT_PUBLIC_AUTH_PROVIDER", "INVESTMENTS_ENABLED", "APP_URL", "SESSION_SECRET", "AUTH_ENABLED"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
  process.env.INVESTMENTS_ENABLED = "true";
  process.env.APP_URL = "https://stockpilot.test";
  process.env.SESSION_SECRET = "investment-gate-test-secret-at-least-32-bytes";
  process.env.AUTH_ENABLED = "true";
  try {
    const prepare = createInvestmentPreparePost({ prepare: async () => { throw new Error("must not call Jupiter"); } });
    const execute = createInvestmentExecutePost({ executeManual: async () => { throw new Error("must not submit a transaction"); } });
    for (const post of [prepare, execute]) {
      const request = new Request("https://stockpilot.test/api/investments", {
        method: "POST",
        body: "malformed",
      });
      const response = await post(request);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
      assert.equal(request.bodyUsed, false);
    }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
