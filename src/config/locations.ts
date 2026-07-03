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

/** Set of normalized locations for O(1) exact lookup. */
const NORMALIZED_LOCATIONS_SET = new Set(NORMALIZED_LOCATIONS);

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

/**
 * Checks whether a property is in a location of interest.
 *
 * Uses EXACT matching on parish/municipality/district (not substring),
 * plus district scoping to eliminate false positives.
 *
 * - Properties KNOWN to be outside Aveiro/Porto districts are rejected.
 * - Within those districts (or when district is unknown), any exact match
 *   on parish, municipality, or district counts as a hit.
 * - The `location` field (street address) uses word-boundary regex as a
 *   fallback for free-text addresses like "Rua de Argoncilhe".
 *
 *   parish "Canelas", district "Porto"        → true  (Canelas, VNG)
 *   municipality "Porto de Mós", district ""  → false (exact: "porto de mós" !== "porto")
 *   district "Lisboa"                          → false (outside Aveiro/Porto)
 *   location "Rua de Argoncilhe", district "" → true  (word-boundary on address)
 */
export function isPropertyInLocation(
  p: {
    location?: string;
    district?: string;
    municipality?: string;
    parish?: string;
  },
  zoneDistricts?: string[]
): boolean {
  const district = normalizeText(p.district || "");

  // District scope: reject properties known to be outside zone districts
  // (only applied when zoneDistricts is provided and non-empty)
  if (zoneDistricts && zoneDistricts.length > 0 && district) {
    const normalizedZoneDistricts = zoneDistricts.map(normalizeText);
    if (!normalizedZoneDistricts.includes(district)) {
      return false;
    }
  }

  // Exact match on structured fields
  const parish = normalizeText(p.parish || "");
  const muni = normalizeText(p.municipality || "");

  if (parish && NORMALIZED_LOCATIONS_SET.has(parish)) return true;
  if (muni && NORMALIZED_LOCATIONS_SET.has(muni)) return true;
  if (district && NORMALIZED_LOCATIONS_SET.has(district)) return true;

  // Word-boundary match on address field only
  const addr = normalizeText(p.location || "");
  if (addr) {
    return NORMALIZED_LOCATIONS.some((loc) => {
      const regex = new RegExp(`\\b${escapeRegex(loc)}\\b`, "i");
      return regex.test(addr);
    });
  }

  return false;
}
