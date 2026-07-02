import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parseArea, parseRooms, parsePrice } from "../../utils/parser.js";

/**
 * Parses the OneFix listing page HTML.
 * Based on the real selectors identified in INSTRUCTIONS.md.
 *
 * @param html - Raw HTML of the listing page
 * @returns Extracted Property list + next page URL (null if last page)
 */
export function parseOneFixListing(html: string): {
  properties: Property[];
  nextUrl: string | null;
} {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".property_grid").each((_, card) => {
    const $card = $(card);
    const href = $card.find(".img_area a").attr("href") || "";
    const idMatch = href.match(/\/verba\/(\d+)\//);
    if (!idMatch) return; // skip if no ID

    const externalId = idMatch[1];
    const title = $card.find(".property-title").text().trim();
    const locationRaw = $card.find(".property-text span").first().text().trim();
    const [parish, municipality] = locationRaw.split(",").map((s) => s.trim());

    // Thumbnail
    const imgSrc = $card.find(".img_area img").attr("src") || "";
    const thumbnail = imgSrc ? `https://www.onefix-leiloeiros.pt${imgSrc}` : "";

    // Status (number of bids, etc.)
    const status = $card.find(".property-text a[style*='c33a43']").text().trim();

    properties.push({
      source: "onefix",
      externalId,
      title,
      price: 0, // filled in detail
      location: locationRaw,
      parish,
      municipality,
      area: parseArea(title),
      rooms: parseRooms(title),
      url: `https://www.onefix-leiloeiros.pt${href}`,
      images: thumbnail ? [thumbnail] : [],
      status,
    });
  });

  // Detect next page via "Próximo" button
  const nextUrl = extractNextPageUrl($);
  return { properties, nextUrl };
}

/**
 * Extracts the next page URL from the current HTML.
 * Returns null if there are no more pages.
 */
function extractNextPageUrl($: cheerio.CheerioAPI): string | null {
  const pagination = $("ul.pagination.custom-pagination");
  if (pagination.length === 0) return null;

  let nextUrl: string | null = null;
  pagination.find("a").each((_, el) => {
    const spanText = $(el).find("span").text().trim();
    if (spanText === "Próximo") {
      nextUrl = $(el).attr("href") || null;
      return false; // stop each
    }
  });

  return nextUrl;
}

/**
 * Parses the OneFix detail page HTML.
 * Enriches the base Property with complete data.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Complete Property with detail data
 */
export function parseOneFixDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  return {
    ...base,
    price: extractOpeningValue($),
    openingValue: extractOpeningValue($),
    minSaleValue: extractMinSaleValue($),
    currentBid: extractCurrentBid($),
    description: extractDescription($),
    latitude: extractGps($)?.lat,
    longitude: extractGps($)?.lng,
    images: extractGalleryImages($),
    publishedAt: extractStartDate($),
  };
}

/**
 * Extracts the opening value (Valor de Abertura) from the sidebar.
 */
function extractOpeningValue($: cheerio.CheerioAPI): number {
  const sidebarItems = $(".property_sidebar li");
  let price = 0;
  sidebarItems.each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes("Valor de Abertura")) {
      // the next <li> has the value
      const nextText = $(sidebarItems[i + 1]).text().trim();
      // Format: "3 500,00 €" → 3500
      const cleaned = nextText
        .replace(/[€$\s]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const num = parseFloat(cleaned);
      if (!isNaN(num)) price = num;
    }
  });
  return price;
}

/**
 * Extracts the minimum sale value (Valor Mínimo de Venda) from the sidebar.
 */
function extractMinSaleValue($: cheerio.CheerioAPI): number | undefined {
  const sidebarItems = $(".property_sidebar li");
  let minSaleValue: number | undefined;
  sidebarItems.each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes("Valor Mínimo de Venda")) {
      // the next <li> has the value
      const nextText = $(sidebarItems[i + 1]).text().trim();
      const parsed = parsePrice(nextText);
      if (parsed > 0) minSaleValue = parsed;
    }
  });
  return minSaleValue;
}

/**
 * Extracts the current bid (Valor última licitação) from the sidebar.
 * Note: The label on the site is "Valor última licitação", not "Licitação Atual".
 */
function extractCurrentBid($: cheerio.CheerioAPI): number | undefined {
  const sidebarItems = $(".property_sidebar li");
  let currentBid: number | undefined;
  sidebarItems.each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes("última licitação") || text.includes("Licitação Atual")) {
      // the next <li> has the value
      const nextText = $(sidebarItems[i + 1]).text().trim();
      const parsed = parsePrice(nextText);
      if (parsed > 0) currentBid = parsed;
    }
  });
  return currentBid;
}

/**
 * Extracts GPS (latitude/longitude) from the location tab.
 * Uses regex on the full panel text for robustness.
 */
function extractGps($: cheerio.CheerioAPI): { lat: number; lng: number } | undefined {
  const panel = $("#tb-panel-4");
  if (panel.length === 0) return undefined;

  const text = panel.text();
  // Look for "GPS:" followed by coordinates like "40.725549, -8.045863"
  const match = text.match(/GPS:\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  return undefined;
}

/**
 * Extracts the description from paragraphs in the details tab.
 */
function extractDescription($: cheerio.CheerioAPI): string | undefined {
  const descriptionParagraphs: string[] = [];
  $("#tb-panel-1 p").each((_, el) => {
    const text = $(el).text().trim();
    if (text) descriptionParagraphs.push(text);
  });
  const description = descriptionParagraphs.join("\n");
  return description || undefined;
}

/**
 * Extracts images from the gallery.
 */
function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  $("div.gallery-item-main img.imagem-verba-principal").each((_, el) => {
    const src = $(el).attr("src");
    if (src) images.push(`https://www.onefix-leiloeiros.pt${src}`);
  });
  return images;
}

/**
 * Extracts the auction start date.
 */
function extractStartDate($: cheerio.CheerioAPI): Date | undefined {
  let publishedAt: Date | undefined;
  $(".property_sidebar li").each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes("Data de Início")) {
      const dateText = $(".property_sidebar li").eq(i + 1).text().trim();
      // dateText = "2026-05-27 pelas 09:00"
      const match = dateText.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) publishedAt = new Date(match[1]);
    }
  });
  return publishedAt;
}