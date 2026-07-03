/**
 * Avaliberica Parser
 *
 * Parses avaliberica.pt HTML for listing pages and detail pages.
 *
 * Site structure:
 *  - Listing page (results-page.php): shows auction sales (vendas)
 *  - Detail page (auction-list.php?id=XXX): shows individual items (verbas)
 *
 * Grouping strategy: each sale = ONE Property, with all verba data aggregated.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, extractCoordinates } from "../../utils/parser.js";

/** Type alias for a Cheerio-wrapped element (compatible with cheerio 1.x). */
type CheerioEl = cheerio.Cheerio<AnyNode>;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Metadata extracted from a listing-page sale card. */
export interface SaleLink {
  id: string;
  session: string;
  url: string;
  title: string;
  location: string;
  auctionType: string;
  dateText: string;
  image: string;
  seller: string;
  saleLocation: string;
  contact: string;
  anuncioPdf?: string;
  catalogoPdf?: string;
}

// ─── Listing Page ────────────────────────────────────────────────────────────

/**
 * Parse the listing page HTML.
 *
 * @returns Array of SaleLink (one per featured-item) + total listing pages
 */
export function parseAvalibericaListing(
  html: string
): { sales: SaleLink[]; totalPages: number } {
  const $ = cheerio.load(html);
  const sales: SaleLink[] = [];

  $(".featured-item").each((_, el) => {
    const $el = $(el);
    const sale = extractSaleFromCard($, $el);
    if (sale) sales.push(sale);
  });

  const totalPages = countListingPages($);

  return { sales, totalPages };
}

/** Extract sale metadata from a single `.featured-item` card. */
function extractSaleFromCard(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): SaleLink | null {
  // Parse id + session from onclick="window.location.href='auction-list.php?id=9308&session=XXX'"
  const onclick = $card.attr("onclick") || "";
  const idMatch = onclick.match(/id=(\d+)/);
  const sessionMatch = onclick.match(/session=([a-f0-9]+)/);
  const id = idMatch?.[1];
  const session = sessionMatch?.[1];
  if (!id || !session) return null;

  // Auction type from tooltip text
  const auctionType = $card.find(".tooltiptext").first().text().trim();

  // Location from h2 (format: "Portugal - LOCATION")
  const h2Text = cleanText($card.find("h2").first().text());
  const location = h2Text.replace(/^Portugal\s*[-–—]\s*/i, "").trim();

  // Title/category from h5
  const title = cleanText($card.find("h5").first().text());

  // Image
  const image = $card.find(".bgImage img").attr("src") || "";

  // Seller + sale location + contact from <p>
  const pText = $card.find("p").first();
  const seller = cleanText(pText.find("strong").first().text());
  const fullP = cleanText(pText.text());
  const saleLocation = extractAfterLabel(fullP, "Local da Venda:");
  const contact = extractAfterLabel(fullP, "Contacto:");

  // Date from calendar icon
  const dateText = cleanText(
    $card.find(".fa-calendar").parent().text()
  );

  // PDF links
  const anuncioPdf = $card
    .find('a:contains("Anúncio")')
    .attr("href");
  const catalogoPdf = $card
    .find('a:contains("Catálogo")')
    .attr("href");

  return {
    id,
    session,
    url: `https://www.avaliberica.pt/auction-list.php?id=${id}&session=${session}`,
    title,
    location,
    auctionType,
    dateText,
    image: resolveUrl(image),
    seller,
    saleLocation,
    contact,
    anuncioPdf: anuncioPdf ? resolveUrl(anuncioPdf) : undefined,
    catalogoPdf: catalogoPdf ? resolveUrl(catalogoPdf) : undefined,
  };
}

/** Count total listing pages from pagination. */
function countListingPages($: cheerio.CheerioAPI): number {
  const $pages = $(".pagination .page-numbers ul li");
  if ($pages.length > 0) return $pages.length;

  // Fallback: check for .next link (means at least 2 pages)
  if ($(".pagination .next").length > 0) return 2;

  return 1;
}

// ─── Detail Page ─────────────────────────────────────────────────────────────

/**
 * Parse the detail page HTML and aggregate all verbas into sale-level data.
 *
 * @param html      Detail page HTML
 * @param saleMeta  Metadata from the listing page
 * @returns Partial Property with aggregated verba data
 */
export function parseAvalibericaDetail(
  html: string,
  saleMeta: SaleLink
): Partial<Property> {
  const $ = cheerio.load(html);

  const verbas = $('div[id^="auctionDiv_"]')
    .map((_, el) => extractVerba($, $(el)))
    .get();

  // Aggregate prices
  const totalPrice = verbas.reduce((sum, v) => sum + v.price, 0);
  const totalCurrentBid = verbas.reduce((sum, v) => sum + (v.currentBid || 0), 0);

  // Aggregate images (deduplicated)
  const allImages = [...new Set(verbas.flatMap((v) => v.images))];

  // Aggregate description
  const description = formatAggregatedDescription(verbas);

  // Use first verba's coordinates
  const coords = verbas.find((v) => v.latitude !== undefined);

  // Collect all document links
  const documents = [...new Set(verbas.flatMap((v) => v.documents))];

  return {
    price: totalPrice,
    currentBid: totalCurrentBid > 0 ? totalCurrentBid : undefined,
    description,
    images: allImages.length > 0 ? allImages : saleMeta.image ? [saleMeta.image] : [],
    latitude: coords?.latitude,
    longitude: coords?.longitude,
    openingValue: totalPrice > 0 ? totalPrice : undefined,
    status: "active",
    publishedAt: parseDetailDate(saleMeta.dateText),
  };
}

/** Count total detail pages (pagination within a sale's verbas). */
export function countDetailPages(html: string): number {
  const $ = cheerio.load(html);
  const $pages = $(".pagination .page-numbers ul li");
  if ($pages.length > 0) return $pages.length;
  return 1;
}

// ─── Verba Extraction ────────────────────────────────────────────────────────

interface VerbaData {
  title: string;
  price: number;
  currentBid?: number;
  description: string;
  images: string[];
  latitude?: number;
  longitude?: number;
  documents: string[];
}

/** Extract data from a single verba div. */
function extractVerba(
  $: cheerio.CheerioAPI,
  $verba: CheerioEl
): VerbaData {
  const verbaId = ($verba.attr("id") || "").replace("auctionDiv_", "");

  // Title: "Verba 1"
  const title = cleanText($verba.find("h2").first().text());

  // Images from carousel (deduplicate main + modal)
  const images = extractVerbaImages($, $verba);

  // Description: prefer full modal text, fallback to truncated paragraph
  const description = extractVerbaDescription($, $verba);

  // Price: "Valor Base" or "Valor Minimo"
  const { price, currentBid } = extractVerbaPrices($, $verba);

  // Coordinates from Google Maps iframe
  const iframeSrc = $verba.find('iframe[src*="maps"]').attr("src");
  const coords = extractCoordinates(iframeSrc);

  // Documents from tab2
  const documents = extractVerbaDocuments($, $verba, verbaId);

  return {
    title,
    price,
    currentBid,
    description,
    images,
    latitude: coords?.lat,
    longitude: coords?.lon,
    documents,
  };
}

/** Extract images from verba carousel, avoiding modal duplicates. */
function extractVerbaImages(
  $: cheerio.CheerioAPI,
  $verba: CheerioEl
): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Main carousel only (not modal)
  const carouselId = $verba.find('[id^="carousel-"]').first().attr("id");
  if (carouselId) {
    $verba.find(`#${carouselId} .carousel-inner .item img`).each((_, img) => {
      const src = $(img).attr("src");
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push(resolveUrl(src));
      }
    });
  }

  return images;
}

/** Extract description: full modal text preferred, fallback to truncated. */
function extractVerbaDescription(
  $: cheerio.CheerioAPI,
  $verba: CheerioEl
): string {
  // Try full description from modal first
  const modalDesc = $verba.find('[id^="modalDescricao_"] .modal-body p').text().trim();
  if (modalDesc) return cleanText(modalDesc);

  // Fallback: truncated paragraph
  const truncated = $verba.find(".col-md-5 > p").first().text().trim();
  return cleanText(truncated);
}

/** Extract price values from the list-info section. */
function extractVerbaPrices(
  $: cheerio.CheerioAPI,
  $verba: CheerioEl
): { price: number; currentBid?: number } {
  let price = 0;
  let currentBid: number | undefined;

  $verba.find(".list-info li").each((_, li) => {
    const $li = $(li);
    const text = cleanText($li.text());

    // "Valor Base: 306.000,00 €" or "Valor Minimo: 308.597,81 €"
    if (text.includes("Valor Base") || text.includes("Valor Minimo")) {
      const priceMatch = text.match(/([\d.,]+)\s*€/);
      if (priceMatch) {
        price = parsePrice(priceMatch[1]);
      }
    }

    // "Valor Actual: 0,00 €"
    if (text.includes("Valor Actual")) {
      const bidMatch = text.match(/([\d.,]+)\s*€/);
      if (bidMatch) {
        currentBid = parsePrice(bidMatch[1]);
      }
    }
  });

  return { price, currentBid };
}

/** Extract document PDF links from the documentation tab. */
function extractVerbaDocuments(
  $: cheerio.CheerioAPI,
  $verba: CheerioEl,
  verbaId: string
): string[] {
  const docs: string[] = [];
  const $tab = $verba.find(`#tab2_${verbaId}`);

  $tab.find("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (href && href.endsWith(".pdf")) {
      docs.push(resolveUrl(href));
    }
  });

  return docs;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize whitespace in text. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

/** Extract text after a label like "Local da Venda:" or "Contacto:". */
function extractAfterLabel(text: string, label: string): string {
  const regex = new RegExp(`${escapeRegex(label)}\\s*(.+?)(?:\\s*(?:Contacto:|Local da Venda:|$))`, "i");
  const match = text.match(regex);
  return match ? cleanText(match[1]) : "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve relative URLs to absolute. */
function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.avaliberica.pt${url}`;
  return `https://www.avaliberica.pt/${url}`;
}

/** Parse date text like "07-07-2026, 11:00" → Date. */
function parseDetailDate(dateText: string): Date {
  // Format: DD-MM-YYYY, HH:mm
  const match = dateText.match(/(\d{2})-(\d{2})-(\d{4})[,\s]+(\d{2}):(\d{2})/);
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
  return new Date();
}

/** Format aggregated verba descriptions into a readable block. */
function formatAggregatedDescription(verbas: VerbaData[]): string {
  if (verbas.length === 0) return "";
  if (verbas.length === 1) {
    const v = verbas[0];
    return `${v.title} — ${formatPrice(v.price)}\n${v.description}`;
  }

  const parts = verbas.map((v) => {
    const priceStr = v.price > 0 ? formatPrice(v.price) : "Preço sob consulta";
    return `▸ ${v.title} (${priceStr})\n${v.description}`;
  });

  return `${verbas.length} verbas neste leilão:\n\n${parts.join("\n\n")}`;
}

/** Format a number as Portuguese price string. */
function formatPrice(value: number): string {
  return value.toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
}
