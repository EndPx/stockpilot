export function shortenAddress(address: string, visibleCharacters = 4): string {
  if (visibleCharacters < 1 || address.length <= visibleCharacters * 2 + 3) {
    return address;
  }

  return `${address.slice(0, visibleCharacters)}...${address.slice(-visibleCharacters)}`;
}
