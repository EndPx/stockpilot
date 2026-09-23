import { MarketLoadingIndicator } from "@/components/market-loading-indicator";

export default function PublicAssetLoading() {
  return <section className="market-loading-stage"><MarketLoadingIndicator label="Loading asset details" /></section>;
}
