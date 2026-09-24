import { authorizationServerMetadata } from "@/lib/control-plane/oauth-metadata";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  return authorizationServerMetadata();
}
