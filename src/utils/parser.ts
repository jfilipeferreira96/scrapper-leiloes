/**
 * Converts Portuguese price strings ("120.000,00 €" or "120000") to a number.
 */
export function parsePrice(raw: string | undefined | null): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/[€$\s]/g, "")
    .replace(/\./g, "")      // remove thousand separator
    .replace(",", ".")       // comma decimal → period
    .replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Converts "150 m²" or "150m2" to a number.
 */
export function parseArea(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const match = raw.replace(/[m²²]/gi, "").match(/[\d.,]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(".", "").replace(",", "."));
  return isNaN(num) ? undefined : num;
}

/**
 * Extracts number of rooms from strings like "T3", "3 quartos".
 */
export function parseRooms(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const tMatch = raw.match(/T\s*(\d+)/i);
  if (tMatch) return parseInt(tMatch[1], 10);
  const numMatch = raw.match(/(\d+)\s*(quarto|divis|room)/i);
  if (numMatch) return parseInt(numMatch[1], 10);
  return undefined;
}