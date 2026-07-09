/**
 * CParaiso Parser.
 *
 * Parses listing and detail pages from cparaiso.pt.
 *
 * Site mechanism:
 *  - Listing page: /pt/auction/category/id/5 (Imóveis category)
 *  - Grid layout with auction items in <ul class="slide">
 *  - Detail pages: /pt/leiloes/{slug}/{slug}
 *  - Each detail page shows one lot with full information
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice, parsePortugueseDate } from "../../utils/parser.js";

/** Base URL for building absolute links. */
const BASE_URL = "https://cparaiso.pt";

/**
 * Parses the listing page and extracts basic property information.
 *
 * @param html - Raw HTML of the listing page
 * @returns Array of basic Property objects
 */
export function parseCparaisoListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".auction-grid .slide > li").each((_, item) => {
    const $item = $(item);

    // --- URL ---
    const $link = $item.find(".image > a.img").first();
    const href = $link.attr("href") || "";
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    if (!url) return;

    // --- External ID (extract from URL) ---
    // URL format: /pt/leiloes/{slug}/{slug}
    // We'll extract from detail page instead
    const externalId = "";

    // --- Title ---
    const title = $item.find(".content h2 a").first().attr("title")?.trim() || "";

    // --- Image ---
    const imgSrc = $item.find(".image > a.img > img").first().attr("src") || "";
    const image = imgSrc ? (imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`) : undefined;

    // --- Auction type ---
    const auctionTypeImg = $item.find(".lot-auction-type-container img").first().attr("alt") || "";
    const auctionType = auctionTypeImg === "Leilão Online" ? "Leilão Online" :
                        auctionTypeImg === "Negociação Particular" ? "Negociação Particular" :
                        undefined;

    // --- End date ---
    // Format: "Termina a 13/07/2026 11:00"
    const dateText = $item.find(".date-count p").first().text().trim();
    const publishedAt = parseEndDate(dateText);

    properties.push({
      source: "cparaiso",
      externalId,
      title,
      description: undefined,
      price: 0,
      location: "Localização não especificada",
      district: undefined,
      municipality: undefined,
      url,
      images: image ? [image] : [],
      auctionType,
      status: "A decorrer",
      publishedAt,
    });
  });

  return properties;
}

/**
 * Parses a detail page and enriches the base Property.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Enriched Property
 */
export function parseCparaisoDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // --- Reference (external ID) ---
  // Format: "Lote 100507"
  const refText = $(".lot-ref").first().text().trim();
  const externalId = refText.replace("Lote", "").trim() || base.externalId;

  // --- Title ---
  const title = $("h1").first().text().trim() || base.title;

  // --- Images (full-size from fancybox links) ---
  const images = extractImages($);

  // --- Description ---
  // Extract from the nested .description inside .tab-content.description
  // The top-level .description contains cookie info
  const descriptionEl = $(".tab-content.description .description").first();
  const description = descriptionEl.text().trim() || base.description;

  // --- Location (municipality) ---
  // Format: "Concelho: Mação"
  const locationText = $(".lot-details p").first().text().trim();
  const municipality = locationText.replace("Concelho:", "").trim() || undefined;
  const location = municipality || base.location;

  // --- Price (Valor Inicial) ---
  // Try primary currency first, then fall back to quick bid values
  let priceText = $(".amount.primary-currency").first().text().trim();
  let price = parsePrice(priceText);
  
  // If price is 0, try extracting from quick bid values
  if (price === 0) {
    const quickBidText = $("#auto_licitation li").first().text().trim();
    price = parsePrice(quickBidText);
  }

  // --- Status ---
  const statusLabel = $(".countdown-label").first().text().trim();
  const status = statusLabel || base.status;

  // --- District (extract from title if available) ---
  // Title format: "... - Freguesia e Concelho de MAÇÃO, Distrito SANTARÉM"
  const district = extractDistrict(title);

  return {
    ...base,
    externalId,
    title,
    description,
    price,
    location,
    district,
    municipality,
    images: images.length > 0 ? images : base.images,
    status,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses end date from Portuguese format.
 * Format: "Termina a 13/07/2026 11:00"
 */
function parseEndDate(text: string): Date | undefined {
  if (!text) return undefined;
  // Remove "Termina a " and parse DD/MM/YYYY HH:MM
  const cleaned = text.replace(/Termina a\s*/i, "").trim();
  const match = cleaned.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hours, minutes] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes)
    );
  }
  return undefined;
}

/**
 * Extracts all image URLs from the detail page.
 */
function extractImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  $(".images a.fancybox").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      images.push(url);
    }
  });
  return [...new Set(images)];
}

/**
 * Extracts district from title if available.
 * Format: "... - Freguesia e Concelho de MAÇÃO, Distrito SANTARÉM"
 */
function extractDistrict(title: string): string | undefined {
  if (!title) return undefined;
  const match = title.match(/Distrito\s+([A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ]+)/i);
  return match ? match[1] : undefined;
}