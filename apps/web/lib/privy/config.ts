export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmudnl6lc00lv0dl587wr6mj9";

export function isPrivyMode(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_PROVIDER === "privy";
}
