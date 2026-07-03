/**
 * Inlex Leiloeira Parser
 *
 * Parses inlexleiloeira.pt HTML for listing pages and detail pages.
 *
 * Site structure:
 *  - Listing page (/tipo_verbas/1/Imoveis): grid of property cards
 *  - Detail page (/verba/{id}/{slug}): single property with full data
 *
 * Two detail page variants:
 *  - "Leilão Eletrônico" — full data (prices, dates, GPS, many images)
 *  - "Negociação" — minimal data (no prices, "Brevemente" status)
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, extractCoordinates } from "../../utils/parser.js";

/** Type alias for a Cheerio-wrapped element (compatible with cheerio 1.x). */
type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://www.inlexleiloeira.pt";

/** Maximum number of images to collect per property. */
const MAX_IMAGES = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Metadata extracted from a listing-page property card. */
export interface ListingItem {
  id: string;
  url: string;
  title: string;
  image: string;
  location: string;
  auctionType: string;
}

// ─── Listing Page ────────────────────────────────────────────────────────────

/**
 * Parse the listing page HTML.
 *
 * @returns Array of ListingItem (one per property card) + total listing pages
 */
export function parseInlexListing(
  html: string
): { items: ListingItem[]; totalPages: number } {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  // Each card is a div.project-single with onclick="location.href='/verba/...'"
  $("div.project-single").each((_, el) => {
    const $el = $(el);
    const item = extractListingItem($, $el);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  });

  const totalPages = countListingPages($);

  return { items, totalPages };
}

/** Extract property metadata from a single listing card. */
function extractListingItem(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  // Parse ID from onclick or href
  const onclick = $card.attr("onclick") || "";
  const href = $card.find("a.homes-img").attr("href") || "";
  const path = onclick || href;
  const idMatch = path.match(/\/verba\/(\d+)/);
  if (!idMatch) return null;
  const id = idMatch[1];

  // URL from onclick (preferred) or href
  const urlPath = onclick.match(/location\.href='([^']+)'/)?.[1] || href;
  if (!urlPath) return null;

  // Title from h3 a[title]
  const title = cleanText(
    $card.find("h3.c-verba-individual-title a").first().attr("title") || ""
  ) || cleanText($card.find("h3.c-verba-individual-title").first().text());

  // Image from img.img-responsive
  const image = resolveUrl(
    $card.find("img.img-responsive").attr("src") || ""
  );

  // Location from p.homes-address span
  const location = cleanText(
    $card.find("p.homes-address span").first().text()
  );

  // Auction type from div.homes-tag text
  const tagText = cleanText($card.find("div.homes-tag").first().text());
  const auctionType = tagText.toLowerCase().includes("negociação")
    ? "Negociação"
    : "Leilão Eletrônico";

  return {
    id,
    url: resolveUrl(urlPath),
    title,
    image,
    location,
    auctionType,
  };
}

/** Count total listing pages from the pagination. */
function countListingPages($: cheerio.CheerioAPI): number {
  let maxPage = 1;
  $("ul.pagination li a span").each((_, span) => {
    const text = cleanText($(span).text());
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > maxPage) {
      maxPage = num;
    }
  });
  return maxPage;
}

// ─── Detail Page ─────────────────────────────────────────────────────────────

/**
 * Parse the detail page HTML and extract enriched property data.
 *
 * @param html     Detail page HTML
 * @param listing  Metadata from the listing page
 * @returns Partial Property with enriched data
 */
export function parseInlexDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  // Title from detail page (b with green color), fallback to listing
  const detailTitle = cleanText(
    $('b[style*="#7c814f"]').first().text()
  );
  const title = detailTitle || listing.title;

  // Images from gallery (bigger versions), fallback to carousel
  const images = extractDetailImages($, listing.image);

  // Auction type from sidebar heading
  const sidebarHeading = cleanText(
    $(".widget-boxed-header h4").first().text()
  );
  const auctionType = sidebarHeading.includes("Negociação")
    ? "Negociação"
    : sidebarHeading.includes("Leilão")
      ? "Leilão Eletrônico"
      : listing.auctionType;

  // Prices from sidebar "Valores" section
  const valorBase = extractSidebarValue($, "Valor Base");
  const valorAbertura = extractSidebarValue($, "Valor Abertura");
  const valorMinimo = extractSidebarValue($, "Valor Mínimo Venda");

  const baseValue = parsePrice(valorBase);
  const openingValue = parsePrice(valorAbertura);
  const minValue = parsePrice(valorMinimo);

  // Price priority: Valor Mínimo Venda > Valor Base
  const price = minValue > 0 ? minValue : baseValue;

  // GPS coordinates
  const coords = extractGps($);

  // Description
  const description = extractDescription($);

  // End date from embedded JavaScript
  const publishedAt = extractEndDateFromJs(html);

  // Location fields from listing
  const [parish, municipality] = parseLocationParts(listing.location);

  // Property type (optional)
  const propertyType = extractPropertyType($);

  return {
    title,
    description,
    price,
    openingValue: openingValue > 0 ? openingValue : baseValue > 0 ? baseValue : undefined,
    minSaleValue: minValue > 0 ? minValue : undefined,
    location: listing.location,
    district: "",
    municipality,
    parish,
    url: listing.url,
    images,
    latitude: coords?.lat,
    longitude: coords?.lon,
    auctionType,
    status: "active",
    publishedAt,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract images from gallery (bigger versions), fallback to carousel. */
function extractDetailImages(
  $: cheerio.CheerioAPI,
  fallbackImage: string
): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Prefer gallery _bigger.jpg links
  $(".row.gallery-item a[href*='_bigger']").each((_, a) => {
    if (images.length >= MAX_IMAGES) return;
    const href = $(a).attr("href") || "";
    if (href && !seen.has(href)) {
      seen.add(href);
      images.push(resolveUrl(href));
    }
  });

  // Fallback: carousel images
  if (images.length === 0) {
    $("#verbaSlideshow .carousel-item img").each((_, img) => {
      if (images.length >= MAX_IMAGES) return;
      const src = $(img).attr("src") || "";
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push(resolveUrl(src));
      }
    });
  }

  // Last resort: listing thumbnail
  if (images.length === 0 && fallbackImage) {
    images.push(fallbackImage);
  }

  return images;
}

/** Extract a sidebar value by finding the <li> with a <b> label. */
function extractSidebarValue(
  $: cheerio.CheerioAPI,
  label: string
): string {
  let value = "";
  $("li.c-verba-sidebar-list-item").each((_, li) => {
    const $li = $(li);
    const bText = cleanText($li.find("b").text());
    if (bText.includes(label)) {
      value = cleanText($li.find("span").text());
    }
  });
  return value;
}

/** Extract GPS coordinates from the location section. */
function extractGps(
  $: cheerio.CheerioAPI
): { lat: number; lon: number } | undefined {
  // Method 1: Parse from "GPS:" text in the location box
  const locationBox = $(".c-verba-location-item")
    .filter(function () {
      return $(this).text().includes("GPS:");
    })
    .parent();

  if (locationBox.length) {
    const fullText = locationBox.text();
    const gpsMatch = fullText.match(
      /GPS:\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/
    );
    if (gpsMatch) {
      const lat = parseFloat(gpsMatch[1]);
      const lon = parseFloat(gpsMatch[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lon };
      }
    }
  }

  // Method 2: Fallback to Google Maps iframe
  const iframeSrc = $('iframe[src*="maps.google.com"]').attr("src") || "";
  return extractCoordinates(iframeSrc);
}

/** Extract and clean the description text. */
function extractDescription($: cheerio.CheerioAPI): string {
  // Clone the "Informação Geral" content box
  const $box = $(".c-tabs-box-main").first().clone();
  if ($box.length === 0) return "";

  // Remove non-description elements
  $box.find(".c-verba-description-item").remove();
  $box.find(".c-verba-share-box").remove();
  $box.find('b[style*="#7c814f"]').remove();
  $box.find(".row").remove();

  // Get text and clean
  return cleanText($box.text());
}

/** Extract property type (e.g., "Edifício") from description items. */
function extractPropertyType($: cheerio.CheerioAPI): string {
  let type = "";
  $(".c-verba-description-item").each((_, el) => {
    const $el = $(el);
    const bText = cleanText($el.find("b").text());
    if (bText.includes("Tipo:")) {
      // Text after <b>Tipo:</b>
      const fullText = cleanText($el.text());
      type = fullText.replace(/^Tipo:\s*/i, "").trim();
    }
  });
  return type;
}

/** Parse end date from embedded JavaScript: var end = new Date(Y,M,D,H,m,s); */
function extractEndDateFromJs(html: string): Date {
  // Month is 0-indexed in JS Date constructor
  const match = html.match(
    /var\s+end\s*=\s*new\s+Date\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/
  );
  if (match) {
    const [, year, month, day, hours, minutes] = match;
    return new Date(
      parseInt(year),
      parseInt(month),
      parseInt(day),
      parseInt(hours),
      parseInt(minutes)
    );
  }
  return new Date();
}

/** Split location text "Parish, Municipality" into parts. */
function parseLocationParts(location: string): [string, string] {
  const parts = location.split(",").map((s) => s.trim());
  const parish = parts[0] || "";
  const municipality = parts[1] || "";
  return [parish, municipality];
}

/** Normalize whitespace in text. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

/** Resolve relative URLs to absolute inlexleiloeira.pt URLs. */
function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}
