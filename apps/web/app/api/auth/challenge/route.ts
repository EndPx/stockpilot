import { createAuthChallenge, encodeAuthChallenge, normalizeWalletAddress } from "@/lib/auth/challenge";
import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { authErrorResponse, jsonResponse, readJsonBody, setChallengeCookie } from "@/lib/auth/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const body = await readJsonBody(request) as { walletAddress?: unknown };
    const walletAddress = normalizeWalletAddress(body?.walletAddress);
    const challenge = createAuthChallenge(walletAddress, config);
    const token = await encodeAuthChallenge(challenge, config.sessionSecret);
    const headers = new Headers();
    setChallengeCookie(headers, token, config);
    return jsonResponse({ input: challenge.input }, { headers });
  } catch (error) {
    return authErrorResponse(error);
  }
}
