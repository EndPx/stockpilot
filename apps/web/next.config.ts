import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@stockpilot/core", "@stockpilot/integrations"],
};
export default config;
