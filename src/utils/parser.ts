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

/**
 * Parses a Portuguese-formatted date string.
 *
 * Handles three known formats used by the auction sites:
 *  1. Numeric: "2026-05-27 pelas 09:00" or "2026-05-27"
 *  2. Long:    "27 de maio de 2026 - 09:00:00"
 *  3. Short:   "15/06/2026 09:00:00" (DD/MM/YYYY HH:mm:ss)
 *
 * @param raw - Date string in one of the supported formats
 * @returns Parsed Date, or undefined if it cannot be parsed
 */
export function parsePortugueseDate(
  raw: string | undefined | null
): Date | undefined {
  if (!raw) return undefined;

  // Map of Portuguese month names (lowercase, without diacritics) → month index
  const months: Record<string, number> = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2, // "março" → "marco" after diacritic removal
    abril: 3,
    maio: 4,
    junho: 5,
    julho: 6,
    agosto: 7,
    setembro: 8,
    outubro: 9,
    novembro: 10,
    dezembro: 11,
  };

  // Inline normalization (same logic as config/locations.ts) to keep this
  // utility self-contained — no cross-module dependency for a small helper.
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  // 1. Short format: "15/06/2026 09:00:00" (DD/MM/YYYY HH:mm:ss)
  const shortMatch = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (shortMatch) {
    const [, day, month, year, hours, minutes, seconds] = shortMatch;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds)
    );
  }

  // 2. Long format: "27 de maio de 2026 - 09:00:00"
  const longMatch = normalized.match(
    /(\d+)\s+de\s+([a-z]+)\s+de\s+(\d+)\s*-?\s*(\d+):(\d+)(?::(\d+))?/
  );
  if (longMatch) {
    const [, day, month, year, hours, minutes, seconds] = longMatch;
    const monthNum = months[month];
    if (monthNum === undefined) return undefined;
    return new Date(
      parseInt(year),
      monthNum,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      seconds ? parseInt(seconds) : 0
    );
  }

  // 3. Numeric format: "2026-05-27 pelas 09:00" or "2026-05-27"
  const numericMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (numericMatch) {
    const [, year, month, day] = numericMatch;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    );
  }

  return undefined;
}

/**
 * Extracts GPS coordinates from a Google Maps URL.
 *
 * Handles the patterns used by the different auction sites:
 *  - Query param:  ?q=41.0411458,-8.6070196  or  ?query=40.725549,-8.045863
 *  - Iframe src:   https://maps.google.com/maps?q=41.0411458, -8.6070196&...
 *
 * @param url - URL that may contain coordinates
 * @returns Object with lat/lon, or undefined if not found
 */
export function extractCoordinates(
  url: string | undefined | null
): { lat: number; lon: number } | undefined {
  if (!url) return undefined;

  // Match "q=12.34, -56.78" or "query=12.34,-56.78"
  const match = url.match(/(?:q|query)=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!match) return undefined;

  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lon)) return undefined;

  return { lat, lon };
}
