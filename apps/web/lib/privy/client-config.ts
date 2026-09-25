import type { PrivyClientConfig } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

export function createPrivyClientConfig(appId: string): PrivyClientConfig {
  // These are Privy's default public mainnet endpoints. Only the public app ID
  // belongs in browser configuration; never reuse the server's private RPC URL.
  const appQuery = `?privyAppId=${encodeURIComponent(appId)}`;
  return {
    loginMethods: ["google", "email"],
    embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
    externalWallets: {
      // Keep connector readiness initialization: Privy 3.45's Solana useWallets
      // also waits for it, even when the selected wallet is embedded.
      walletConnect: { enabled: false },
    },
    appearance: { theme: "dark", accentColor: "#5468ff" },
    solana: {
      rpcs: {
        "solana:mainnet": {
          rpc: createSolanaRpc(`https://solana-mainnet.rpc.privy.systems${appQuery}`),
          rpcSubscriptions: createSolanaRpcSubscriptions(`wss://solana-mainnet.rpc.privy.systems${appQuery}`),
          blockExplorerUrl: "https://explorer.solana.com?cluster=mainnet",
        },
      },
    },
  };
}
