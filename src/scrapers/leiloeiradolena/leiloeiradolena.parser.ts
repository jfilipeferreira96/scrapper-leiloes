/**
 * Leiloeira do Lena Parser.
 *
 * Listing loads via AJAX: a POST to `lista_leiloes` returns the first batch
 * and opens a server-side session; repeated GETs to `lista_leiloes/` return
 * the next batches, until the body comes back empty or a lone ".". Detail
 * pages live at `/leilao/{id}/{slug}`.
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice, parsePortugueseDate } from "../../utils/parser.js";

const BASE_URL = "https://www.leiloeiradolena.com";

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

    // href looks like: leilao/1016/apartamento-t3-rua-general-vasco-goncalves-guarda
    const href = $link.attr("href") || "";
    const url = buildAbsoluteUrl(href);
    const idMatch = href.match(/leilao\/(\d+)/);
    const externalId = idMatch ? idMatch[1] : $item.attr("id")?.replace("ref", "") || "";
    if (!externalId) return;

    const title =
      ($link.attr("title") || "").trim() ||
      $item.find(".titulo").text().trim();

    const auctionType = $item.find(".tipo").text().trim() || undefined;

    const processRef = $item.find(".ref").text().replace(/\s+/g, " ").trim();

    // .local has two <span>: "District » Municipality" and "specific location"
    const locationSpans = $item.find(".local span");
    const concelhoText = locationSpans.eq(0).text().trim();
    const localizacaoText = locationSpans.eq(1).text().trim();
    const { district, municipality } = parseConcelhoLine(concelhoText);

    // .dataFim: <span>Termina</span>2026-07-17 11:00:00
    const endDateText = $item.find(".dataFim").text().replace(/Termina/i, "").trim();
    const publishedAt = parsePortugueseDate(endDateText);

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

export function parseLeiloeiraDolenaDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  const title = $(".titulo h2").first().text().trim() || base.title;

  const refText = $(".itemOP.refleilao").text().replace(/Referência:/i, "").trim();
  const externalId = refText || base.externalId;

  const auctionType = $(".itemOP.tipo").first().text().trim() || base.auctionType;

  const locationInfo = extractLocation($);

  const startDate = extractDateField($, ".inicio");
  const endDate = extractDateField($, ".fim");
  const publishedAt = startDate || base.publishedAt;

  const description = $(".boxTexto").not(".obs").first().text().trim() || base.description;

  const priceInfo = extractLotPrices($);

  const images = extractGalleryImages($);

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

function buildAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `${BASE_URL}${href}`;
  return `${BASE_URL}/${href}`;
}

/** "Concelho" line format: "District » Municipality" (e.g. "Guarda » Guarda"). */
function parseConcelhoLine(raw: string): { district?: string; municipality?: string } {
  if (!raw) return {};
  const parts = raw.split("»").map((p) => p.trim());
  if (parts.length >= 2) {
    return { district: parts[0], municipality: parts[1] };
  }
  return { municipality: parts[0] };
}

/**
 * .itemOP.local rows look like <div><span>Concelho</span> Guarda » Guarda </div>.
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

/** .datas_leilao fields: <span>Início Leilão:</span> 2026-07-02 11:00:00 */
function extractDateField($: cheerio.CheerioAPI, selector: string): Date | undefined {
  const text = $(`.datas_leilao ${selector}`).text();
  const dateStr = text.replace(/.*:\s*/, "").trim();
  return parsePortugueseDate(dateStr);
}

/**
 * Lot section (.box_leilao_info.lote): labelled .itemOP rows
 * (Valor abertura / Valor mínimo / Estado) plus a .lance_actual box
 * for the current bid.
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

  $firstLot.find(".linhaLote .itemOP").each((_, el) => {
    const $el = $(el);
    const label = $el.children("span").not(".valor").first().text().trim().toLowerCase();
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
 * Gallery images: a.zoom_foto links, plus the main listing image (mypic/L-{id}).
 */
function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];

  $("a.zoom_foto").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      images.push(buildAbsoluteUrl(href));
    }
  });

  $(".boxFoto img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src.includes("mypic/L-")) {
      images.push(buildAbsoluteUrl(src));
    }
  });

  return [...new Set(images)];
}
