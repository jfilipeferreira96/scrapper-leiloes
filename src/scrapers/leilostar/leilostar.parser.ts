/**
 * Leilostar Parser
 *
 * Parses leilostar.pt HTML for listing pages and detail pages.
 *
 * Site structure:
 *  - Listing page (index.php?page=bem_list): grid of property cards
 *  - Detail page (index.php?page=bem_detail&event_id=X&id=Y): single property
 *
 * Each listing card links to exactly one detail page (1:1 mapping).
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, parseArea, extractCoordinates } from "../../utils/parser.js";

/** Type alias for a Cheerio-wrapped element (compatible with cheerio 1.x). */
type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://www.leilostar.pt";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Metadata extracted from a listing-page property card. */
export interface ListingItem {
  eventId: string;
  id: string;
  url: string;
  title: string;
  reference: string;
  image: string;
  auctionType: string;
  minPrice: number;
  endDateText: string;
}

// ─── Listing Page ────────────────────────────────────────────────────────────

/**
 * Parse the listing page HTML.
 *
 * @returns Array of ListingItem (one per property card) + total listing pages
 */
export function parseLeilostarListing(
  html: string
): { items: ListingItem[]; totalPages: number } {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  // Each card is wrapped in an <a href="index.php?page=bem_detail&...">
  $('a[href*="bem_detail"]').each((_, el) => {
    const $el = $(el);
    const item = extractListingItem($, $el);
    if (item) items.push(item);
  });

  const totalPages = countListingPages($);

  return { items, totalPages };
}

/** Extract property metadata from a single listing card. */
function extractListingItem(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  // Parse event_id + id from href
  const href = $card.attr("href") || "";
  const eventId = href.match(/event_id=(\d+)/)?.[1];
  const id = href.match(/[&?]id=(\d+)/)?.[1];
  if (!eventId || !id) return null;

  // Title from h3 > div
  const title = cleanText($card.find(".proerty_text h3 div").first().text());

  // Reference from <p> (e.g., "REF: 327MON2026")
  const refText = cleanText($card.find(".proerty_text p").first().text());
  const reference = refText.replace(/^REF:\s*/i, "").trim();

  // Image from inline background:url('...')
  const styleDiv = $card.find(".image div[style*='background']").first();
  const image = extractBackgroundUrl(styleDiv.attr("style") || "");

  // Auction type from tooltip
  const auctionType = cleanText(
    $card.find(".modVendaIconOnList").attr("data-original-title") || ""
  );

  // Price from .price .tag (e.g., "Valor Mínimo: 20.060,00 €")
  const priceText = cleanText($card.find(".price .tag").first().text());
  const minPrice = extractPriceFromText(priceText);

  // End date from .favroute span (e.g., "até 29/07/2026")
  const endDateText = cleanText($card.find(".favroute span").first().text());

  return {
    eventId,
    id,
    url: resolveUrl(href),
    title,
    reference,
    image,
    auctionType,
    minPrice,
    endDateText,
  };
}

/** Count total listing pages from the pager. */
function countListingPages($: cheerio.CheerioAPI): number {
  // Each <li> in the pager represents a page number
  const $pages = $("ul.pager li");
  if ($pages.length > 0) return $pages.length;
  return 1;
}

// ─── Detail Page ─────────────────────────────────────────────────────────────

/**
 * Parse the detail page HTML and extract enriched property data.
 *
 * @param html     Detail page HTML
 * @param listing  Metadata from the listing page
 * @returns Partial Property with enriched data
 */
export function parseLeilostarDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  // Title (override listing title — detail page has the full title)
  const title = cleanText($("#property h2").first().text()) || listing.title;

  // District from h5 next to map marker
  const districtH5 = cleanText($("#property h5").first().text());

  // Images from owl carousel
  const images = extractDetailImages($);

  // Build characteristic map from both Características and Localização boxes
  const chars = buildCharacteristicMap($);

  // Prices
  const minValue = extractRowValue($, "Valor Mínimo");
  const baseValue = extractRowValue($, "Valor Base");
  const price = minValue > 0 ? minValue : baseValue;

  // Description
  const description = cleanText($(".boxDescricao p").first().text());

  // Coordinates: prefer explicit c_row values, fallback to iframe
  let latitude: number | undefined;
  let longitude: number | undefined;

  const latStr = chars["Latitude"];
  const lonStr = chars["Longitude"];
  if (latStr && lonStr) {
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (!isNaN(lat) && !isNaN(lon)) {
      latitude = lat;
      longitude = lon;
    }
  }
  if (latitude === undefined || longitude === undefined) {
    const iframeSrc = $('iframe[src*="maps.google.com"]').attr("src") || "";
    const coords = extractCoordinates(iframeSrc);
    if (coords) {
      latitude = coords.lat;
      longitude = coords.lon;
    }
  }

  // Area: prefer "Área Total", fallback to "Área Construção"
  const area = parseArea(chars["Área Total"]) || parseArea(chars["Área Construção"]);

  // Location fields from characteristic map
  const district = chars["Distrito"] || districtH5 || "";
  const municipality = chars["Concelho"] || "";
  const parish = chars["Freguesia"] || "";

  // Auction type: prefer detail page value, fallback to listing
  const auctionType = chars["Modalidade de Venda"] || listing.auctionType;

  // End date
  const publishedAt = parseEndDate(listing.endDateText);

  return {
    title,
    description,
    price,
    openingValue: baseValue > 0 ? baseValue : undefined,
    minSaleValue: minValue > 0 ? minValue : undefined,
    location: [district, municipality, parish].filter(Boolean).join(", "),
    district,
    municipality,
    parish,
    area,
    images: images.length > 0 ? images : listing.image ? [listing.image] : [],
    latitude,
    longitude,
    auctionType,
    status: "active",
    publishedAt,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract all images from the detail page owl carousel. */
function extractDetailImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  $("#property-d-1 .owl-item .item img").each((_, img) => {
    const src = $(img).attr("src");
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });

  return images;
}

/**
 * Build a map of all characteristic item→value pairs from all
 * .boxCaracteristicas blocks on the detail page.
 */
function buildCharacteristicMap(
  $: cheerio.CheerioAPI
): Record<string, string> {
  const map: Record<string, string> = {};

  $(".boxCaracteristicas .c_row").each((_, row) => {
    const $row = $(row);
    const key = cleanText($row.find(".item").text());
    const value = cleanText($row.find(".value").text());
    if (key) map[key] = value;
  });

  return map;
}

/** Extract a numeric price from a .row_p with the given title label. */
function extractRowValue(
  $: cheerio.CheerioAPI,
  label: string
): number {
  let value = 0;
  $(".row_p").each((_, row) => {
    const $row = $(row);
    const title = cleanText($row.find(".title").text());
    if (title.includes(label)) {
      const valText = cleanText($row.find(".value").text());
      value = parsePrice(valText);
    }
  });
  return value;
}

/** Extract a URL from a CSS background:url('...') style string. */
function extractBackgroundUrl(style: string): string {
  const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return match ? resolveUrl(match[1]) : "";
}

/** Extract a numeric price from text like "Valor Mínimo: 20.060,00 €". */
function extractPriceFromText(text: string): number {
  const match = text.match(/([\d.,]+)\s*€/);
  return match ? parsePrice(match[1]) : 0;
}

/** Parse end date text like "até 29/07/2026" → Date. */
function parseEndDate(text: string): Date {
  // Format: DD/MM/YYYY
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    );
  }
  return new Date();
}

/** Normalize whitespace in text. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

/** Resolve relative URLs to absolute leilostar.pt URLs. */
function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}
