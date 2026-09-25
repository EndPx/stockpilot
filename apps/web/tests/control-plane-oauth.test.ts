import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { bindOAuthSubject, oauthClientName, resolveOAuthPrincipal } from "../lib/control-plane/oauth-binding";
import { getAgentOAuthConfig } from "../lib/control-plane/oauth-config";
import { authorizationServerMetadata, protectedResourceMetadata } from "../lib/control-plane/oauth-metadata";
import { parseWorkosAccessClaims, verifyOAuthCredential, verifySignedToken } from "../lib/control-plane/oauth-tokens";
import { completeWorkosExternalAuth, getWorkosUserByExternalId, getWorkosUserById, WorkosApiProtocolError, WorkosApiStatusError } from "../lib/control-plane/workos-api";

const scripts = await Promise.all([
  "0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")));
const issuer = "https://stockpilot-test.authkit.app";
const resource = "https://stockpilot.endpx.cloud/api/mcp";
const config = { issuer, resource, appOrigin: "https://stockpilot.endpx.cloud", apiKey: "sk_test_only_not_a_real_key" };
const subject = "user_01JQ0E27VT3MH79RY0FVA4QBP9";
const clientId = "client_01JP8BD0CZ401TDF9X54NT5ZEK";
const privy = "did:privy:alice";
const wallet = "11111111111111111111111111111111";

function mockFetch(value: unknown, status = 200): typeof fetch {
  return (async () => Response.json(value, { status })) as typeof fetch;
}

test("OAuth stays opt-in and publishes only exact MCP audience and trusted issuer", async () => {
  const names = ["AGENT_OAUTH_ENABLED", "NEXT_PUBLIC_AUTH_PROVIDER", "PRIVY_APP_SECRET", "CONTROL_PLANE_DATABASE_URL",
    "WORKOS_AUTHKIT_ISSUER", "WORKOS_API_KEY", "APP_URL", "SESSION_SECRET", "AUTH_ENABLED"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      AGENT_OAUTH_ENABLED: "false", NEXT_PUBLIC_AUTH_PROVIDER: "privy", PRIVY_APP_SECRET: "secret",
      CONTROL_PLANE_DATABASE_URL: "postgres://unused", WORKOS_AUTHKIT_ISSUER: issuer,
      WORKOS_API_KEY: config.apiKey, APP_URL: config.appOrigin, SESSION_SECRET: "test-secret-longer-than-thirty-two-bytes", AUTH_ENABLED: "true",
    });
    assert.equal(getAgentOAuthConfig(), null);
    assert.equal(protectedResourceMetadata().status, 503);
    process.env.AGENT_OAUTH_ENABLED = "true";
    const active = getAgentOAuthConfig();
    assert.equal(active?.resource, resource);
    const metadata = await protectedResourceMetadata().json();
    assert.deepEqual(metadata, { resource, authorization_servers: [issuer], bearer_methods_supported: ["header"] });
    process.env.WORKOS_AUTHKIT_ISSUER = "http://127.0.0.1:9000";
    assert.equal(getAgentOAuthConfig(), null);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("authorization metadata proxy rejects a mismatched upstream issuer", async () => {
  const previous = Object.fromEntries(["AGENT_OAUTH_ENABLED", "NEXT_PUBLIC_AUTH_PROVIDER", "PRIVY_APP_SECRET", "CONTROL_PLANE_DATABASE_URL",
    "WORKOS_AUTHKIT_ISSUER", "WORKOS_API_KEY", "APP_URL", "SESSION_SECRET", "AUTH_ENABLED"].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, { AGENT_OAUTH_ENABLED: "true", NEXT_PUBLIC_AUTH_PROVIDER: "privy", PRIVY_APP_SECRET: "secret",
      CONTROL_PLANE_DATABASE_URL: "postgres://unused", WORKOS_AUTHKIT_ISSUER: issuer,
      WORKOS_API_KEY: config.apiKey, APP_URL: config.appOrigin, SESSION_SECRET: "test-secret-longer-than-thirty-two-bytes", AUTH_ENABLED: "true" });
    const denied = await authorizationServerMetadata(mockFetch({ issuer: "https://evil.example",
      authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token` }));
    assert.equal(denied.status, 503);
    const accepted = await authorizationServerMetadata(mockFetch({ issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token` }));
    assert.equal(accepted.status, 200);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("WorkOS completion accepts only provider redirect and exact external Privy ID", async () => {
  const externalAuthId = "ext_auth_01J3X4Y5Z6A7B8C9D0E1F2G3H4";
  const redirect = `${issuer}/oauth/authorize/complete?state=opaque`;
  assert.equal((await completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: redirect }))).toString(), redirect);
  const oauth2Redirect = `${issuer}/oauth2/authorize/complete?state=opaque`;
  assert.equal((await completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: oauth2Redirect }))).toString(), oauth2Redirect);
  const providerOwnedRedirect = `${issuer}/connect/finish?state=opaque`;
  assert.equal((await completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: providerOwnedRedirect }))).toString(), providerOwnedRedirect);
  await assert.rejects(completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: "https://evil.example/steal" })), (error) => {
      assert.ok(error instanceof WorkosApiProtocolError);
      assert.equal(error.code, "untrusted_origin");
      assert.doesNotMatch(error.message, /evil\.example/);
      return true;
    });
  await assert.rejects(completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: `https://attacker@${new URL(issuer).host}/connect/finish?state=opaque` })),
    (error) => error instanceof WorkosApiProtocolError && error.code === "untrusted_redirect");
  await assert.rejects(completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: `${issuer}/oauth2/authorize/complete?state=opaque#fragment` })),
    (error) => error instanceof WorkosApiProtocolError && error.code === "untrusted_redirect");
  await assert.rejects(completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({})), (error) => error instanceof WorkosApiProtocolError && error.code === "missing_redirect");
  await assert.rejects(completeWorkosExternalAuth(externalAuthId, privy, "alice@example.com", config,
    mockFetch({ redirect_uri: "%" })), (error) => error instanceof WorkosApiProtocolError && error.code === "malformed_redirect");
  assert.deepEqual(await getWorkosUserById(subject, config,
    mockFetch({ id: subject, external_id: privy })), { id: subject, externalId: privy });
  assert.deepEqual(await getWorkosUserByExternalId(privy, config,
    mockFetch({ id: subject, external_id: privy })), { id: subject, externalId: privy });
  await assert.rejects(getWorkosUserByExternalId(privy, config,
    mockFetch({ id: subject, external_id: "did:privy:bob" })));
  await assert.rejects(getWorkosUserById(subject, config,
    mockFetch({ id: subject, external_id: "did:privy:bob" }, 403)));
  await assert.rejects(getWorkosUserById(subject, config,
    mockFetch({ error: "private upstream explanation" }, 429)), (error) => {
      assert.ok(error instanceof WorkosApiStatusError);
      assert.equal(error.status, 429);
      assert.doesNotMatch(error.message, /private upstream explanation/);
      return true;
    });
});

test("JWT claim gate rejects ID/M2M tokens and requires consent and openid", () => {
  const valid = { sub: subject, client_id: clientId, sid: "app_consent_01JPXN6KAQW83AMXXY5WX3RHTJ",
    jti: "01JPXN6KFGZQYW3AM2DEVX84YS", iat: 1_800_000_000, exp: 1_800_000_300, scope: "openid profile" };
  assert.deepEqual(parseWorkosAccessClaims(valid), { subject, clientId });
  assert.deepEqual(parseWorkosAccessClaims({ ...valid, sub: privy }), { subject: privy, clientId });
  assert.deepEqual(parseWorkosAccessClaims({ ...valid, client_id: "https://chatgpt.com/oauth/client-metadata.json",
    sid: "consent-12345678" }), { subject, clientId: "https://chatgpt.com/oauth/client-metadata.json" });
  assert.equal(parseWorkosAccessClaims({ ...valid, sub: clientId }), null);
  assert.equal(parseWorkosAccessClaims({ ...valid, sub: "did:privy:" }), null);
  assert.equal(parseWorkosAccessClaims({ ...valid, sub: "did:privy:alice/bob" }), null);
  assert.equal(parseWorkosAccessClaims({ ...valid, sub: `did:privy:${"a".repeat(119)}` }), null);
  assert.equal(parseWorkosAccessClaims({ ...valid, sid: undefined }), null);
  assert.equal(parseWorkosAccessClaims({ ...valid, scope: "profile" }), null);
});

test("JWT signature verifier enforces WorkOS issuer, exact MCP audience, expiry and RS256", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-workos-key";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const claims = { sub: subject, client_id: clientId, sid: "app_consent_01JPXN6KAQW83AMXXY5WX3RHTJ",
    jti: "01JPXN6KFGZQYW3AM2DEVX84YS", scope: "openid profile" };
  async function signed(tokenIssuer: string, audience: string | string[], expiresIn: string | number = "5m") {
    return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setIssuer(tokenIssuer).setAudience(audience).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey);
  }
  assert.deepEqual(await verifySignedToken(await signed(issuer, resource), config, keys), { subject, clientId });
  const privyToken = await new SignJWT({ ...claims, sub: privy }).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer).setAudience(resource).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.deepEqual(await verifySignedToken(privyToken, config, keys), { subject: privy, clientId });
  assert.equal(await verifySignedToken(await signed(issuer, [resource, "https://other.example/api/mcp"]), config, keys), null);
  assert.equal(await verifySignedToken(await signed(issuer, "https://other.example/api/mcp"), config, keys), null);
  assert.equal(await verifySignedToken(await signed("https://evil.example", resource), config, keys), null);
  assert.equal(await verifySignedToken(await signed(issuer, resource, "-1h"), config, keys), null);
});

test("JWT diagnostics report fixed categories without recording token material", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-workos-key";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const claims = { sub: subject, client_id: clientId, sid: "app_consent_01JPXN6KAQW83AMXXY5WX3RHTJ",
    jti: "01JPXN6KFGZQYW3AM2DEVX84YS", scope: "openid profile" };
  const signed = (payload: Record<string, unknown>, tokenIssuer = issuer, audience: string | string[] = resource,
    expiresIn = "5m") => new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(tokenIssuer).setAudience(audience).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey);
  const failures: string[] = [];
  const check = async (token: string, expected: string) => {
    failures.length = 0;
    assert.equal(await verifySignedToken(token, config, keys, (reason) => failures.push(reason)), null);
    assert.deepEqual(failures, [expected]);
    assert.equal(failures.join(" ").includes(token), false);
  };
  await check(await signed(claims, "https://other.example"), "jwt_issuer");
  await check(await signed(claims, issuer, "https://other.example/api/mcp"), "jwt_audience");
  await check(await signed(claims, issuer, [resource, "https://other.example/api/mcp"]), "jwt_audience");
  await check(await signed(claims, issuer, resource, "-1h"), "jwt_expired");
  await check(await signed({ ...claims, sub: undefined }), "jwt_claims_subject_missing");
  await check(await signed({ ...claims, sub: 123 }), "jwt_claims_subject_missing");
  await check(await signed({ ...claims, sub: "user_short" }), "jwt_claims_subject_workos_malformed");
  await check(await signed({ ...claims, sub: "did:privy:" }), "jwt_claims_subject_privy");
  await check(await signed({ ...claims, sub: "did:privy:bad/id" }), "jwt_claims_subject_privy");
  await check(await signed({ ...claims, sub: clientId }), "jwt_claims_subject_client");
  await check(await signed({ ...claims, sub: "opaque-subject-example" }), "jwt_claims_subject_other");
  await check(await signed({ ...claims, sid: undefined }), "jwt_claims_consent");
  await check(await signed({ ...claims, scope: "profile" }), "jwt_claims_scope");
  failures.length = 0;
  const token = await signed(claims);
  assert.equal(await verifySignedToken(token, config, async () => { throw Object.assign(new Error("private"),
    { code: "ERR_JWKS_TIMEOUT" }); }, (reason) => failures.push(reason)), null);
  assert.deepEqual(failures, ["jwt_key_unavailable"]);
});

test("OAuth subject requires browser binding; connection defaults to markets-only and revocation stays closed", async () => {
  const db = await PGlite.create();
  await db.exec(scripts.join("\n"));
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const claims = { subject, clientId };
    assert.equal(await resolveOAuthPrincipal(claims, privy, config, store), null);
    await bindOAuthSubject({ privyUserId: privy, walletAddress: wallet, workosUserId: subject }, config, store);
    assert.equal(await resolveOAuthPrincipal(claims, "did:privy:bob", config, store), null);
    const principal = await resolveOAuthPrincipal(claims, privy, config, store);
    assert.equal(principal?.authMethod, "oauth");
    assert.equal(principal?.walletAddress, wallet);
    assert.deepEqual(principal?.scopes, ["markets:read"]);
    const policy = await db.query<{ buy_mode: string; sell_mode: string; max_investment_usd: string; daily_request_limit_usd: string }>(
      "SELECT buy_mode, sell_mode, max_investment_usd, daily_request_limit_usd FROM control_grant_policies WHERE client_id = $1", [principal?.clientId]);
    assert.equal(policy.rows[0].buy_mode, "DISABLED");
    assert.equal(policy.rows[0].sell_mode, "DISABLED");
    assert.equal(policy.rows[0].max_investment_usd, "10.000000");
    assert.equal(policy.rows[0].daily_request_limit_usd, "50.000000");
    const same = await resolveOAuthPrincipal(claims, privy, config, store);
    assert.equal(same?.clientId, principal?.clientId);
    await db.query("UPDATE control_oauth_connections SET revoked_at = now() WHERE client_id = $1", [principal?.clientId]);
    assert.equal(await resolveOAuthPrincipal(claims, privy, config, store), null);
  } finally { await db.close(); }
});

test("signed Privy subject resolves through exact WorkOS external ID to an existing internal subject binding", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-workos-key";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (tokenSubject: string) => new SignJWT({ sub: tokenSubject, client_id: clientId,
    sid: "app_consent_01JPXN6KAQW83AMXXY5WX3RHTJ", jti: "01JPXN6KFGZQYW3AM2DEVX84YS", scope: "openid profile" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer(issuer).setAudience(resource)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const token = await sign(privy);
  const db = await PGlite.create();
  await db.exec(scripts.join("\n"));
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  const failures: string[] = [];
  const externalReads: string[] = [];
  let internalReads = 0;
  const dependencies: NonNullable<Parameters<typeof verifyOAuthCredential>[2]> = {
    verifyToken: (value, oauth, _unused, onFailure) =>
      verifySignedToken(value, oauth, keys, onFailure),
    readUser: async () => { internalReads++; throw new Error("Internal lookup must not run for Privy subjects"); },
    readUserByExternalId: (externalId, oauth) => {
      externalReads.push(externalId);
      return getWorkosUserByExternalId(externalId, oauth, mockFetch({ id: subject, external_id: privy }));
    },
    resolve: (claims, externalId, oauth) =>
      resolveOAuthPrincipal(claims, externalId, oauth, store),
    onFailure: (reason: string) => { failures.push(reason); },
  };
  try {
    assert.equal(await verifyOAuthCredential(token, config, dependencies), null);
    assert.deepEqual(failures, ["principal_unavailable"]);
    assert.equal((await db.query("SELECT subject FROM control_oauth_subject_bindings")).rows.length, 0);

    await bindOAuthSubject({ privyUserId: privy, walletAddress: wallet, workosUserId: subject }, config, store);
    failures.length = 0;
    const principal = await verifyOAuthCredential(token, config, dependencies);
    assert.equal(principal?.authMethod, "oauth");
    if (principal?.authMethod !== "oauth") throw new Error("OAuth principal was not returned");
    assert.equal(principal.oauthSubject, subject);
    assert.equal(principal?.accountId, privy);
    assert.equal(principal?.walletAddress, wallet);
    assert.equal(principal.oauthClientId, clientId);
    assert.deepEqual(principal?.scopes, ["markets:read"]);
    assert.deepEqual(failures, []);
    assert.deepEqual(externalReads, [privy, privy]);
    assert.equal(internalReads, 0);
    const connection = await db.query<{ subject: string; oauth_client_id: string }>(
      "SELECT subject, oauth_client_id FROM control_oauth_connections");
    assert.deepEqual(connection.rows, [{ subject, oauth_client_id: clientId }]);

    failures.length = 0;
    assert.equal(await verifyOAuthCredential(token, config, {
      ...dependencies,
      readUserByExternalId: async () => ({ id: subject, externalId: "did:privy:bob" }),
      resolve: async () => { throw new Error("Mismatched identity reached binding lookup"); },
    }), null);
    assert.deepEqual(failures, ["identity_mismatch"]);

    failures.length = 0;
    assert.equal(await verifyOAuthCredential(await sign("did:privy:bad/id"), config, dependencies), null);
    assert.deepEqual(failures, ["jwt_claims_subject_privy"]);

    await assert.rejects(verifyOAuthCredential(token, config, {
      ...dependencies,
      readUserByExternalId: async () => { throw new WorkosApiStatusError(503); },
      resolve: async () => { throw new Error("Failed WorkOS lookup reached binding lookup"); },
    }), (error) => error instanceof WorkosApiStatusError && error.status === 503);
  } finally { await db.close(); }
});

test("OAuth credential verification rejects malformed tokens before any remote call", async () => {
  let remoteCalls = 0;
  const failures: string[] = [];
  assert.equal(await verifyOAuthCredential("not-a-jwt", config, {
    readUser: async () => { remoteCalls++; return { id: subject, externalId: privy }; },
    onFailure: (reason) => failures.push(reason),
  }), null);
  assert.equal(remoteCalls, 0);
  assert.deepEqual(failures, ["token_shape"]);
});

test("known OAuth client domains get readable agent names without trusting arbitrary client metadata", () => {
  assert.equal(oauthClientName("https://chatgpt.com/oauth/codex/example/client.json"), "Codex");
  assert.equal(oauthClientName("https://chatgpt.com/oauth/connectors/example.json"), "ChatGPT");
  assert.equal(oauthClientName("https://claude.ai/oauth/client.json"), "Claude");
  assert.equal(oauthClientName("https://chatgpt.com.evil.example/client.json"), "OAuth client");
  assert.equal(oauthClientName("client_01JP8BD0CZ401TDF9X54NT5ZEK"), "OAuth client");
});

test("OAuth diagnostics classify token and binding failure without exposing credential material", async () => {
  const failures: string[] = [];
  const fakeToken = `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`;
  const report = (reason: string) => { failures.push(reason); };
  assert.equal(await verifyOAuthCredential(fakeToken, config, {
    verifyToken: async () => null,
    onFailure: report,
  }), null);
  assert.equal(await verifyOAuthCredential(fakeToken, config, {
    verifyToken: async () => ({ subject, clientId }),
    readUser: async () => ({ id: subject, externalId: privy }),
    resolve: async () => null,
    onFailure: report,
  }), null);
  assert.deepEqual(failures, ["jwt_rejected", "principal_unavailable"]);
  assert.equal(failures.join(" ").includes(fakeToken), false);
});
