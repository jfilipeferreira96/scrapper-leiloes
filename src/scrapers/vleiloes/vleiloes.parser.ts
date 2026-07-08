/**
 * VLeiloes Parser.
 *
 * Parses listing and detail pages from www.vleiloes.com.
 *
 * Auction types (param ?tipo=N):
 *   1 → Leilão Presencial
 *   2 → Leilão Electrónico
 *   5 → Negociação
 *   6 → Carta Fechada
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

/** Base URL for building absolute links. */
const BASE_URL = "https://www.vleiloes.com";

/** Maps the ?tipo= query param to a human-readable auction type. */
export const AUCTION_TYPE_LABELS: Record<number, string> = {
  1: "Leilão Presencial",
  2: "Leilão Electrónico",
  5: "Negociação",
  6: "Carta Fechada",
};

/**
 * Parses a listing page from vleiloes.com.
 *
 * Each item is a `div.post_content` block containing the lot summary,
 * image, price box, and a `<script>` with the end-time timestamp.
 *
 * @param html - Raw HTML of the listing page
 * @param auctionType - Human-readable auction type label
 * @returns Array of basic Property objects
 */
export function parseVLeiloesListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".lista_vendas .post_content").each((_, item) => {
    const $item = $(item);

    // --- URL & external id ---
    // Link looks like ./?page=leilao&leilao=772&venda=316&tipo=2
    const detailHref = $item.find(".pesquisa_titulo a").attr("href") || "";
    const url = buildAbsoluteUrl(detailHref);

    const leilaoMatch = detailHref.match(/leilao=(\d+)/);
    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = leilaoMatch ? leilaoMatch[1] : "";
    const venda = vendaMatch ? vendaMatch[1] : "";
    if (!externalId) return;

    // --- Title ---
    const title = $item.find(".pesquisa_titulo h1").text().trim();

    // --- Description (raw text) ---
    const description = $item.find(".texto_lote").text().trim();

    // --- Image (thumbnail) ---
    const imgSrc = $item.find(".span3 a img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    // --- Prices ---
    // Valor Minimo → infobox_valorbase
    // Valor Actual → id="valor-actual-{leilao}"
    const minText = $item.find(".infobox_valorbase p").text().trim();
    const minSaleValue = parsePrice(minText);
    const currentBid = parsePrice(
      $item.find(`#valor-actual-${externalId}`).text()
    );
    // Use currentBid as the main price; fall back to minimum.
    const price = currentBid || minSaleValue || 0;

    // --- End date from embedded JS (lasttime = Unix seconds) ---
    const endDate = extractEndDateFromScript($item, externalId);

    // --- Start date from description text "INÍCIO: dd/mm/aaaa hh:mm" ---
    const publishedAt = extractStartDateFromText(description);

    // --- Location from description (best-effort heuristic) ---
    const location = extractLocationFromText(description);

    properties.push({
      source: "vleiloes",
      externalId,
      title,
      description,
      price,
      minSaleValue: minSaleValue || undefined,
      currentBid: currentBid || undefined,
      location: location || "Localização não especificada",
      auctionType,
      url,
      images: image ? [image] : [],
      status: "A decorrer",
      publishedAt,
      // endDate is not a Property field but kept for reference via publishedAt
    });
  });

  return properties;
}

/**
 * Parses a detail (lot) page and enriches the base Property.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Enriched Property
 */
export function parseVLeiloesDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // --- Gallery images: <a data-lightbox="loteX" href="...">
  const images = extractGalleryImages($);

  // --- Description (detail page has cleaner text) ---
  const description =
    $(".detalhe_verba .post_content p").text().trim() || base.description;

  // --- Prices: detail page shows Valor Base / Valor Minimo / Valor Abertura / Valor Actual ---
  const priceInfo = extractDetailPrices($);

  // --- Dates from description text ---
  const publishedAt = extractStartDateFromText(description ?? "") || base.publishedAt;

  // --- Location (best-effort) ---
  const location = extractLocationFromText(description ?? "") || base.location;

  return {
    ...base,
    description,
    price: priceInfo.currentBid || priceInfo.openingValue || base.price,
    openingValue: priceInfo.openingValue,
    minSaleValue: priceInfo.minSaleValue,
    currentBid: priceInfo.currentBid,
    location,
    images: images.length > 0 ? images : base.images,
    publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds an absolute URL from a possibly-relative href found in the page. */
function buildAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("./")) href = href.substring(2);
  return `${BASE_URL}/${href}`;
}

/**
 * Extracts the end date from the embedded JS `lasttime` variable.
 * The listing script contains:  var lasttime = 1775733360;
 */
function extractEndDateFromScript(
  $item: cheerio.Cheerio<any>,
  _leilaoId: string
): Date | undefined {
  const scriptText = $item.find("script").first().html() || "";
  const match = scriptText.match(/var\s+lasttime\s*=\s*(\d+)/);
  if (match) {
    const seconds = parseInt(match[1], 10);
    return new Date(seconds * 1000);
  }
  return undefined;
}

/**
 * Extracts the start date from text containing "INÍCIO: dd/mm/aaaa hh:mm".
 * @returns Date or undefined
 */
function extractStartDateFromText(text: string): Date | undefined {
  if (!text) return undefined;
  // Normalise INÍCIO (with/without accent)
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(
    /INICIO:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/
  );
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
 * Best-effort extraction of a location from the lot description.
 *
 * Portuguese legal descriptions typically mention "freguesia de X" or
 * "concelho de Y" — we try those patterns and fall back to "sito em Z".
 */
function extractLocationFromText(text: string): string | undefined {
  if (!text) return undefined;

  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. "freguesia de <Name>"
  const fregMatch = normalized.match(/freguesia\s+de\s+([A-Z][A-Za-zÀ-ÿ\s,.-]{2,60})/i);
  if (fregMatch) return cleanLocation(fregMatch[1]);

  // 2. "concelho de <Name>"
  const concMatch = normalized.match(/concelho\s+de\s+([A-Z][A-Za-zÀ-ÿ\s,.-]{2,60})/i);
  if (concMatch) return cleanLocation(concMatch[1]);

  // 3. "sito em <Name>" up to comma or period
  const sitoMatch = normalized.match(/sito\s+em\s+([A-Z][A-Za-zÀ-ÿ\s,.-]{2,60})/i);
  if (sitoMatch) return cleanLocation(sitoMatch[1]);

  return undefined;
}

/** Cleans a raw location string by trimming trailing punctuation/conjunctions. */
function cleanLocation(raw: string): string {
  return raw
    .replace(/[,\s]+(do|da|dos|das|de)\s*$/i, "")
    .replace(/[,\s.]+$/, "")
    .trim();
}

/** Extracts all gallery image URLs from the detail page. */
function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  $(".image_wrapper a[data-lightbox]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      images.push(href.startsWith("http") ? href : buildAbsoluteUrl(href));
    }
  });
  return [...new Set(images)];
}

/** Extracts the price box values from the detail page. */
function extractDetailPrices($: cheerio.CheerioAPI): {
  openingValue: number | undefined;
  minSaleValue: number | undefined;
  currentBid: number | undefined;
} {
  const result = {
    openingValue: undefined as number | undefined,
    minSaleValue: undefined as number | undefined,
    currentBid: undefined as number | undefined,
  };

  // The detail page has multiple .infobox_valorbase blocks with <small> labels.
  $(".infobox_valorbase, .infobox_valoractual").each((_, el) => {
    const $el = $(el);
    const label = $el.find("small").text().trim().toLowerCase();
    const value = parsePrice($el.find("p").text());

    if (label.includes("abertura")) {
      result.openingValue = value;
    } else if (label.includes("minimo") || label.includes("mínimo")) {
      result.minSaleValue = value;
    } else if (label.includes("actual") || label.includes("atual")) {
      result.currentBid = value;
    }
  });

  return result;
}