import type { NextConfig } from "next";
import path from "node:path";
import { baselineSecurityHeaders } from "./lib/security-headers";

const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@stockpilot/core", "@stockpilot/integrations"],
  async headers() {
    return [{ source: "/:path*", headers: baselineSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
};
export default config;
