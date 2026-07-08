/**
 * Leiloeira do Lena Parser.
 *
 * Parses listing fragments and detail pages from www.leiloeiradolena.com.
 *
 * Site mechanism (discovered via curl investigation):
 *  - The listing page (/leiloes) loads items via AJAX. The filter form POSTs
 *    to `lista_leiloes` which returns the FIRST batch of items (HTML fragment)
 *    and initialises a server-side session.
 *  - Subsequent batches are fetched by GETting `lista_leiloes/` repeatedly.
 *    The server tracks the cursor in the session, returning the next batch
 *    each time. When exhausted it returns an empty body or a single ".".
 *  - Detail pages live at `/leilao/{id}/{slug}`.
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice, parsePortugueseDate } from "../../utils/parser.js";

/** Base URL for building absolute links. */
const BASE_URL = "https://www.leiloeiradolena.com";

/**
 * Parses a listing fragment (the HTML returned by the `lista_leiloes` POST
 * and subsequent `lista_leiloes/` GETs).
 *
 * Each item is a `div.item` containing an `<a>` link to the detail page plus
 * a summary (title, auction type, process ref, location, end date).
 *
 * @param html - Raw HTML fragment of one or more listing items
 * @returns Array of basic Property objects
 */
export function parseLeiloeiraDolenaListing(html: string): Property[] {
  // The server signals "no more items" with an empty body or a lone ".".
  if (!html || html.trim() === "" || html.trim() === ".") {
    return [];
  }

  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".item").each((_, item) => {
    const $item = $(item);
    const $link = $item.find("a").first();
    if ($link.length === 0) return;

    // --- URL & external id ---
    // href looks like: leilao/1016/apartamento-t3-rua-general-vasco-goncalves-guarda
    const href = $link.attr("href") || "";
    const url = buildAbsoluteUrl(href);
    const idMatch = href.match(/leilao\/(\d+)/);
    const externalId = idMatch ? idMatch[1] : $item.attr("id")?.replace("ref", "") || "";
    if (!externalId) return;

    // --- Title (prefer link title attribute, fall back to .titulo text) ---
    const title =
      ($link.attr("title") || "").trim() ||
      $item.find(".titulo").text().trim();

    // --- Auction type ---
    const auctionType = $item.find(".tipo").text().trim() || undefined;

    // --- Process reference (kept in description for context) ---
    const processRef = $item.find(".ref").text().replace(/\s+/g, " ").trim();

    // --- Location ---
    // .local has two <span>: "District » Municipality" and "specific location"
    const locationSpans = $item.find(".local span");
    const concelhoText = locationSpans.eq(0).text().trim();
    const localizacaoText = locationSpans.eq(1).text().trim();
    const { district, municipality } = parseConcelhoLine(concelhoText);

    // --- End date ---
    // .dataFim: <span>Termina</span>2026-07-17 11:00:00
    const endDateText = $item.find(".dataFim").text().replace(/Termina/i, "").trim();
    const publishedAt = parsePortugueseDate(endDateText);

    // --- Image (thumbnail) ---
    const imgSrc = $item.find(".boxFoto img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    properties.push({
      source: "leiloeiradolena",
      externalId,
      title,
      description: processRef || undefined,
      price: 0, // Prices are only on the detail page (lot section)
      location: localizacaoText || municipality || concelhoText || "Localização não especificada",
      district,
      municipality,
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
 * Parses a detail (leilão) page and enriches the base Property.
 *
 * The detail page contains:
 *  - Title (.titulo h2)
 *  - Auction metadata (.itemOP.tipo, .refleilao, .tribunal, .local)
 *  - Dates (.datas_leilao .inicio / .fim)
 *  - Description (.boxTexto, excluding .boxTexto.obs)
 *  - Lot section (.box_leilao_info.lote) with prices, status, countdown
 *  - Gallery images (a.zoom_foto[href])
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Enriched Property
 */
export function parseLeiloeiraDolenaDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // --- Title ---
  const title = $(".titulo h2").first().text().trim() || base.title;

  // --- Reference (externalId) ---
  const refText = $(".itemOP.refleilao").text().replace(/Referência:/i, "").trim();
  const externalId = refText || base.externalId;

  // --- Auction type ---
  const auctionType = $(".itemOP.tipo").first().text().trim() || base.auctionType;

  // --- Location (district / municipality / specific) ---
  const locationInfo = extractLocation($);

  // --- Dates ---
  const startDate = extractDateField($, ".inicio");
  const endDate = extractDateField($, ".fim");
  const publishedAt = startDate || base.publishedAt;

  // --- Description (first .boxTexto that is NOT an observation) ---
  const description = $(".boxTexto").not(".obs").first().text().trim() || base.description;

  // --- Prices & status from the first lot section ---
  const priceInfo = extractLotPrices($);

  // --- Gallery images ---
  const images = extractGalleryImages($);

  // --- Tribunal / process info (append to description for context) ---
  const tribunal = $(".itemOP.tribunal").text().trim();
  const processRef = $(".itemOP.ref").text().replace(/Ref\. processo/i, "").trim();
  const fullDescription = [description, tribunal && `Tribunal: ${tribunal}`, processRef && `Processo: ${processRef}`]
    .filter(Boolean)
    .join("\n");

  return {
    ...base,
    externalId,
    title,
    description: fullDescription || description,
    price: priceInfo.openingValue || priceInfo.currentBid || base.price,
    openingValue: priceInfo.openingValue,
    minSaleValue: priceInfo.minSaleValue,
    currentBid: priceInfo.currentBid,
    location: locationInfo.location || base.location,
    district: locationInfo.district || base.district,
    municipality: locationInfo.municipality || base.municipality,
    auctionType,
    images: images.length > 0 ? images : base.images,
    status: priceInfo.status || base.status,
    publishedAt,
    // endDate is not a Property field; publishedAt holds the start date
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds an absolute URL from a possibly-relative href. */
function buildAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `${BASE_URL}${href}`;
  return `${BASE_URL}/${href}`;
}

/**
 * Parses a "Concelho" line like " Guarda » Guarda " into district/municipality.
 * Format: "District » Municipality".
 */
function parseConcelhoLine(raw: string): { district?: string; municipality?: string } {
  if (!raw) return {};
  const parts = raw.split("»").map((p) => p.trim());
  if (parts.length >= 2) {
    return { district: parts[0], municipality: parts[1] };
  }
  return { municipality: parts[0] };
}

/**
 * Extracts location info from the detail page's .itemOP.local block.
 *
 * Structure:
 *   <div class="itemOP local">
 *     <div><span>Concelho</span> Guarda » Guarda </div>
 *     <div><span>Localização</span> Guarda</div>
 *   </div>
 */
function extractLocation($: cheerio.CheerioAPI): {
  location?: string;
  district?: string;
  municipality?: string;
} {
  const result: { location?: string; district?: string; municipality?: string } = {};

  $(".itemOP.local > div").each((_, el) => {
    const $el = $(el);
    const label = $el.find("span").first().text().trim().toLowerCase();
    // Value = text remaining after removing ALL spans from a clone
    const $clone = $el.clone();
    $clone.find("span").remove();
    const value = $clone.text().trim();

    if (label.includes("concelho")) {
      const { district, municipality } = parseConcelhoLine(value);
      result.district = district;
      result.municipality = municipality;
    } else if (label.includes("localiza")) {
      result.location = value;
    }
  });

  return result;
}

/**
 * Extracts a date from a .datas_leilao field.
 * Format: <span>Início Leilão:</span> 2026-07-02 11:00:00
 */
function extractDateField($: cheerio.CheerioAPI, selector: string): Date | undefined {
  const text = $(`.datas_leilao ${selector}`).text();
  // Remove the label text, keep the date
  const dateStr = text.replace(/.*:\s*/, "").trim();
  return parsePortugueseDate(dateStr);
}

/**
 * Extracts price and status information from the first lot section.
 *
 * Structure:
 *   <div id="masterLoteXXXX" class="box_leilao_info lote">
 *     <div class="linhaLote ...">
 *       <div class="itemOP"><span>Valor abertura</span>151.610,00€</div>
 *       <div class="itemOP"><span>Valor mínimo</span>166.600,00€</div>
 *       <div class="itemOP estado"><span>Estado:</span>a decorrer</div>
 *     </div>
 *     ...
 *     <div class="master_lance_actual">
 *       <div class="lance_actual"><div class="valor">0,00€</div></div>
 *     </div>
 */
function extractLotPrices($: cheerio.CheerioAPI): {
  openingValue?: number;
  minSaleValue?: number;
  currentBid?: number;
  status?: string;
} {
  const result: {
    openingValue?: number;
    minSaleValue?: number;
    currentBid?: number;
    status?: string;
  } = {};

  const $firstLot = $(".box_leilao_info.lote").first();
  if ($firstLot.length === 0) return result;

  // Walk the .linhaLote itemOP blocks to find labelled values.
  // Each block: <div class="itemOP"><span>Label</span>value</div>
  $firstLot.find(".linhaLote .itemOP").each((_, el) => {
    const $el = $(el);
    const label = $el.children("span").not(".valor").first().text().trim().toLowerCase();
    // Value = text remaining after removing ALL spans from a clone
    const $clone = $el.clone();
    $clone.children("span").remove();
    const value = $clone.text().trim();

    if (label.includes("abertura")) {
      result.openingValue = parsePrice(value);
    } else if (label.includes("mínimo") || label.includes("minimo")) {
      result.minSaleValue = parsePrice(value);
    } else if (label.includes("estado")) {
      result.status = value;
    }
  });

  // Current bid from the lance_actual box
  const currentBidText = $firstLot.find(".lance_actual .valor").first().text().trim();
  if (currentBidText) {
    const bid = parsePrice(currentBidText);
    if (bid > 0) {
      result.currentBid = bid;
    }
  }

  return result;
}

/**
 * Extracts all gallery image URLs from the detail page.
 *
 * Images appear as <a class="zoom_foto" href="mypic/P-2164-XXXX"> links inside
 * the lot's .box_galeria. The main listing image uses mypic/L-{id}.
 */
function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];

  // Gallery zoom links (full-size images)
  $("a.zoom_foto").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      images.push(buildAbsoluteUrl(href));
    }
  });

  // Main listing image (mypic/L-{id})
  $(".boxFoto img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src.includes("mypic/L-")) {
      images.push(buildAbsoluteUrl(src));
    }
  });

  return [...new Set(images)];
}
