import Image from "next/image";

/** Decorative companion to the adjacent accessible StockPilot name or heading. */
export function BrandMark({ large = false }: { large?: boolean }) {
  const size = large ? 56 : 32;
  return (
    <Image
      src="/brand/stockpilot-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={large ? "brand-mark auth-prompt-mark" : "brand-mark"}
      unoptimized
    />
  );
}
