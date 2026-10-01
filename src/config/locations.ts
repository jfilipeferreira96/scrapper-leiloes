// Target locations: scrapers collect everything, then filter against this list.
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matching so "Anta" doesn't match inside "Santa Maria dos Olivais".
export function isLocationOfInterest(location: string): boolean {
  const normalized = normalizeText(location);
  return NORMALIZED_LOCATIONS.some((loc) => {
    if (normalized === loc) return true;
    const regex = new RegExp(`\\b${escapeRegex(loc)}\\b`, "i");
    return regex.test(normalized);
  });
}

// Exact match on parish/municipality/district, scoped to the target districts when
// they are known; the free-text location field falls back to word-boundary matching
// for addresses like "Rua de Argoncilhe".
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

  if (zoneDistricts && zoneDistricts.length > 0 && district) {
    const normalizedZoneDistricts = zoneDistricts.map(normalizeText);
    if (!normalizedZoneDistricts.includes(district)) {
      return false;
    }
  }

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
