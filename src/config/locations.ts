/**
 * Locations of interest. The scraper collects everything and then filters
 * against this list.
 */
export const LOCATIONS: string[] = [
  "Argoncilhe",
  "Fiães",
  "Sanguedo",
  "Lobão",
  "Lourosa",
  "Nogueira da Regedoura",
  "Paços de Brandão",
  "Rio Meão",
  "Santa Maria de Lamas",
  "São João de Ver",
  "São Paio de Oleiros",
  "Santa Maria da Feira",
  "Mozelos",
  "Sandim",
  "Canedo",
  "Pedroso",
  "Seixezelo",
  "Pedroso e Seixezelo",
  "Arcozelo",
  "Canelas",
  "Serezedo",
  "Olival",
  "Carvalhos",
  "Grijó",
  "Anta",
  "Guetim",
  "Silvalde",
  "Vila Maior",
  "Sermonde",
  "Crestuma",
  "Lever",
  "Esmoriz",
  "Ovar",
  "Espinho",
  "Vila Nova de Gaia",
  "Porto",
  "Aveiro",
];

/**
 * Removes accents and normalizes text for case-insensitive comparison.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const NORMALIZED_LOCATIONS = LOCATIONS.map(normalizeText);

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks whether a free-text location (from the scraper) matches any of the
 * target locations.
 *
 * Uses WORD-BOUNDARY matching to avoid false positives. For example, the
 * parish "Anta" must NOT match inside "Santa Maria dos Olivais".
 *
 *   "Rio Meão, Santa Maria da Feira"  → true  (matches "Rio Meão")
 *   "Santa Maria dos Olivais, Lisboa" → false (no target location found)
 */
export function isLocationOfInterest(location: string): boolean {
  const normalized = normalizeText(location);
  return NORMALIZED_LOCATIONS.some((loc) => {
    if (normalized === loc) return true;
    // Word-boundary match: ensures "anta" doesn't match inside "santa"
    const regex = new RegExp(`\\b${escapeRegex(loc)}\\b`, "i");
    return regex.test(normalized);
  });
}
