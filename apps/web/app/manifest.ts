import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockPilot",
    short_name: "StockPilot",
    description: "Human-approved tokenized-stock investing on Solana.",
    start_url: "/app",
    display: "browser",
    background_color: "#f1f0ed",
    theme_color: "#5468ff",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
