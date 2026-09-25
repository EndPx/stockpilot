import type { ClientRecord } from "./shared";

/** A method's historical presence is not proof that it is still authorized. */
export function agentConnectionLabel(client: ClientRecord): string {
  const hasOAuth = client.authMethods.includes("oauth");
  const hasLegacyKey = client.authMethods.includes("api_key");
  if (hasOAuth && client.oauthRevokedAt) {
    return hasLegacyKey ? "OAuth revoked · Legacy key on record" : "OAuth revoked";
  }
  if (hasOAuth && client.status === "ACTIVE") {
    return hasLegacyKey ? "Connected with OAuth · Legacy key on record" : "Connected with OAuth";
  }
  if (hasOAuth) return "OAuth connection on record";
  return hasLegacyKey ? "Legacy key on record" : "No connection on record";
}
