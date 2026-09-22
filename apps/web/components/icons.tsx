import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" /></IconFrame>;
}

export function MarketsIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 19V9m5 10V5m6 14v-7m5 7V3" /><path d="M3 19h18" /></IconFrame>;
}

export function ShieldIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></IconFrame>;
}

export function ArrowUpRightIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M7 17 17 7M8 7h9v9" /></IconFrame>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m15 18-6-6 6-6" /></IconFrame>;
}

export function SearchIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></IconFrame>;
}

export function WalletIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></IconFrame>;
}

export function CheckIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m5 12 4 4L19 6" /></IconFrame>;
}

export function SparkIcon(props: IconProps) {
  return <IconFrame {...props}><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m18.5 16 .6 2.4 2.4.6-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6.6-2.4Z" /></IconFrame>;
}
