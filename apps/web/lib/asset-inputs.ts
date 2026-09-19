export class InvalidAssetInput extends Error {}

export function parseAssetQuery(value: string | string[] | undefined): string {
  if (Array.isArray(value) || (value !== undefined && (value.length > 100 || /[\x00-\x1f\x7f]/.test(value)))) {
    throw new InvalidAssetInput("Search must be a single value of at most 100 characters.");
  }
  return value?.trim() ?? "";
}

export function parseAssetSymbol(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(value)) {
    throw new InvalidAssetInput("Enter a valid asset symbol of at most 32 characters.");
  }
  return value;
}
