import Image from "next/image";
import Link from "next/link";
import { ArrowUpRightIcon } from "@/components/icons";
import orbital from "@/public/images/stockpilot-orbital.png";
import { investmentsEnabled } from "@/lib/investments/config";
import { marketSectionLabels } from "@/lib/market-navigation";

export default function HomePage() {
  const canInvest = investmentsEnabled();
  return (
    <div className="landing-page">
      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-art" aria-hidden="true">
          <Image src={orbital} alt="" fill sizes="100vw" preload className="hero-image" />
        </div>
        <div className="hero-copy">
          <p className="eyebrow eyebrow-inverse">A new perspective on investing</p>
          <h1 id="hero-title">Your AI agent for <span>tokenized stocks</span> on Solana.</h1>
          <p className="hero-lede">A clearer view of the markets. A deliberate path to invest. Always under your control.</p>
          <div className="hero-actions">
            <Link href="/app" className="button button-light">Open the app <ArrowUpRightIcon /></Link>
            <a href="#market-scope" className="hero-secondary">Discover StockPilot <span aria-hidden="true">↓</span></a>
          </div>
          <p className="hero-stage">Discover Stocks and Pre-IPO today.<br />Agent controls are in development. {canInvest ? "Public-market execution is not enabled." : "Investment execution is currently disabled."}</p>
        </div>
        <div className="hero-caption" aria-hidden="true"><span>STOCKPILOT / 01</span><span>A human at the center.</span></div>
      </section>

      <section className="landing-statement" id="market-scope">
        <p className="section-index">01 / A wider horizon</p>
        <h2>Two markets.<br />One point of control.</h2>
        <p>From private-company exposure to tokenized public-market products. One focused experience, with the source of every asset made clear.</p>
      </section>

      <section className="market-scope" aria-label="Stocks and Pre-IPO discovery">
        <article className="scope-private">
          <div className="scope-heading"><span>{marketSectionLabels.private}</span><span className="scope-status"><i /> Live catalog</span></div>
          <h3>Before the<br />opening bell.</h3>
          <p>Explore pre-IPO exposure through official PreStocks. Every private-market asset in StockPilot comes exclusively from PreStocks.</p>
          <Link href="/markets?group=private" className="text-link">Explore {marketSectionLabels.private} <ArrowUpRightIcon /></Link>
        </article>
        <article className="scope-public">
          <div className="scope-heading"><span>{marketSectionLabels.public}</span><span className="scope-status">Live discovery</span></div>
          <h3>Beyond the<br />traditional ticker.</h3>
          <p>Explore the official xStocks public-market catalog. Classification is shown where verified; discovery does not mean a product is ready to trade.</p>
          <Link href="/markets?group=public" className="text-link">Explore {marketSectionLabels.public} <ArrowUpRightIcon /></Link>
        </article>
      </section>

      <section className="landing-workflow" aria-labelledby="workflow-title">
        <div className="workflow-intro">
          <p className="section-index">02 / Intelligence, with boundaries</p>
          <h2 id="workflow-title">Let an agent help.<br />Keep the final say.</h2>
          <p className="workflow-roadmap">The control plane we&apos;re building. Today, explore both catalogs and {canInvest ? "request PreStocks investments directly in the app." : "view your wallet-held PreStocks. Investment execution is disabled in this release."}</p>
        </div>
        <ol className="workflow-steps">
          <li><span>01</span><div><strong>Give each agent a clear role</strong><p>A separate client identity, with specific permissions and limits. Never your wallet&apos;s private key.</p></div></li>
          <li><span>02</span><div><strong>Review an exact request</strong><p>The asset, amount and transaction stay bound to your decision. A changed request needs a new approval.</p></div></li>
          <li><span>03</span><div><strong>Your wallet. Your signature.</strong><p>Human approval first. Wallet signing next. Confirmation and a traceable record close the loop.</p></div></li>
        </ol>
      </section>
    </div>
  );
}
