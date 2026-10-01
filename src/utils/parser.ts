export function parsePrice(raw: string | undefined | null): number {
  if (!raw) return 0;
  // 120.000,00 -> 120000.00
  const cleaned = raw
    .replace(/[€$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseArea(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const match = raw.replace(/[m²²]/gi, "").match(/[\d.,]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(".", "").replace(",", "."));
  return isNaN(num) ? undefined : num;
}

export function parseRooms(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const tMatch = raw.match(/T\s*(\d+)/i);
  if (tMatch) return parseInt(tMatch[1], 10);
  const numMatch = raw.match(/(\d+)\s*(quarto|divis|room)/i);
  if (numMatch) return parseInt(numMatch[1], 10);
  return undefined;
}

// Handles the formats seen on the auction sites:
// "2026-05-27 pelas 09:00", "27 de maio de 2026 - 09:00:00", "15/06/2026 09:00:00"
export function parsePortugueseDate(
  raw: string | undefined | null
): Date | undefined {
  if (!raw) return undefined;

  const months: Record<string, number> = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2,
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

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

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

  const numericMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (numericMatch) {
    const [, year, month, day] = numericMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  return undefined;
}

export function extractCoordinates(
  url: string | undefined | null
): { lat: number; lon: number } | undefined {
  if (!url) return undefined;

  const match = url.match(/(?:q|query)=(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!match) return undefined;

  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lon)) return undefined;

  return { lat, lon };
}
