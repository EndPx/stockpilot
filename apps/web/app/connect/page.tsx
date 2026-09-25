import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { OAuthConnectSummary, OAuthConnectUnavailable } from "@/components/oauth-connect-summary";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { readActiveAuthSession } from "@/lib/auth/session";
import { getAuthSecurityStore } from "@/lib/auth/store";
import { getAgentOAuthConfig } from "@/lib/control-plane/oauth-config";
import { createOAuthHandoffProof } from "@/lib/control-plane/oauth-handoff";
import { externalAuthIdPattern } from "@/lib/control-plane/workos-api";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Connect an AI app", robots: { index: false, follow: false } };

export default async function ConnectPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isPrivyMode()) notFound();
  const params = await searchParams;
  const id = params.external_auth_id;
  if (typeof id !== "string" || !externalAuthIdPattern.test(id) ||
    Object.keys(params).length !== 1 || !getAgentOAuthConfig()) return <OAuthConnectUnavailable />;

  const config = getAuthRuntimeConfig();
  const cookie = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!cookie) redirect(`/sign-in?next=${encodeURIComponent(`/connect?external_auth_id=${id}`)}`);
  try {
    const session = await readActiveAuthSession(cookie, config, getAuthSecurityStore(config));
    if (session.authProvider !== "privy" || !session.privyUserId) return <OAuthConnectUnavailable />;
    const proof = await createOAuthHandoffProof(id, session, config.sessionSecret);
    return <OAuthConnectSummary externalAuthId={id} walletAddress={session.walletAddress} handoffProof={proof} />;
  } catch {
    return <OAuthConnectUnavailable />;
  }
}
