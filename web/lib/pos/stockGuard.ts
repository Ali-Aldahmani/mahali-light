/**
 * The POS stock rule: a cart line may not ask for more than is on the shelf,
 * unless the store allows negative stock or the line is a custom item.
 * Returns the message to show when the request is too big, otherwise null.
 */
export function stockShortfall({
  name,
  unit = 'pcs',
  stock,
  requested,
  allowNegative = false,
  isCustom = false,
}: {
  name: string;
  unit?: string | null;
  stock: number;
  requested: number;
  allowNegative?: boolean;
  isCustom?: boolean;
}): string | null {
  if (allowNegative || isCustom || !Number.isFinite(stock)) return null;
  if (!(requested > stock)) return null;
  return stock <= 0 ? `${name} is out of stock.` : `Only ${stock} ${unit || 'pcs'} of ${name} in stock.`;
}
