import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, parseArea, extractCoordinates } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://leilovalor.com";

export interface ListingItem {
  eventId: string;
  id: string;
  url: string;
  title: string;
  auctionType: string;
  minPrice: number;
  endDateText: string;
  image: string;
}

// same Virtual Forum engine as capital/leilostar but with a different theme;
// cards are found anchor-first so small theme differences do not break parsing
export function parseLeilovalorListing(html: string): {
  items: ListingItem[];
  totalPages: number;
} {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  $('a[href*="bem_detail"]').each((_, el) => {
    const $el = $(el);
    const item = extractListingItem($, $el);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  });

  const $pages = $("ul.pager li");
  const totalPages = $pages.length > 0 ? $pages.length : 1;

  return { items, totalPages };
}

function extractListingItem(
  $: cheerio.CheerioAPI,
  $anchor: CheerioEl
): ListingItem | null {
  const href = $anchor.attr("href") || "";
  const eventId = href.match(/event_id=(\d+)/)?.[1];
  const id = href.match(/[&?]id=(\d+)/)?.[1];
  if (!eventId || !id) return null;

  const title = cleanText($anchor.text()) || cleanText($anchor.attr("title") || "");

  const $container = $anchor.closest("div.row, div[class*='col-'], li, article, section");
  const containerText = $container.length > 0 ? cleanText($container.first().text()) : "";

  const minMatch = containerText.match(/Valor M[ií]nimo:\s*([\d.,]+)\s*€/i);
  const minPrice = minMatch ? parsePrice(minMatch[1]) : 0;

  const dateMatch = containerText.match(/(?:até|Termina\w*)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const endDateText = dateMatch ? `até ${dateMatch[1]}` : "";

  const modalidadeMatch = containerText.match(
    /(Leilão Presencial|Leilão Online|Negociação Particular|Carta Fechada)/i
  );
  const auctionType = modalidadeMatch ? modalidadeMatch[1] : "";

  const bgStyle = $anchor.find("div[style*='background']").first().attr("style") || "";
  const imgSrc = $anchor.find("img").first().attr("src") || "";
  const image = extractBackgroundUrl(bgStyle) || (imgSrc ? resolveUrl(imgSrc) : "");

  return {
    eventId,
    id,
    url: resolveUrl(href),
    title,
    auctionType,
    minPrice,
    endDateText,
    image,
  };
}

// the detail template is engine-wide (matches capital/leilostar layout)
export function parseLeilovalorDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  const title =
    cleanText($("#property h2").first().text()) ||
    cleanText($(".page-banner h1").first().text()) ||
    listing.title;

  const images = extractDetailImages($);

  const chars = buildCharacteristicMap($);

  const minValue = extractRowValue($, "Valor Mínimo");
  const baseValue = extractRowValue($, "Valor Base");
  const price = minValue > 0 ? minValue : baseValue;

  const description =
    cleanText($(".boxDescricao p").first().text()) ||
    cleanText($(".container .col-md-12 p").first().text());

  let latitude: number | undefined;
  let longitude: number | undefined;

  const latStr = chars["Latitude"];
  const lonStr = chars["Longitude"];
  if (latStr && lonStr) {
    const lat = parseFloat(latStr.replace(",", "."));
    const lon = parseFloat(lonStr.replace(",", "."));
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

  const area = parseArea(chars["Área Total"]) || parseArea(chars["Área Construção"]);

  const district = chars["Distrito"] || "";
  const municipality = chars["Concelho"] || "";
  const parish = chars["Freguesia"] || "";

  const auctionType = chars["Modalidade de Venda"] || listing.auctionType;

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

function extractDetailImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  $(
    "#property-d-1 .owl-item .item img, .owl-carousel .owl-item .item img, .carousel-inner .item img"
  ).each((_, img) => {
    const src = $(img).attr("src");
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });

  return images;
}

function buildCharacteristicMap(
  $: cheerio.CheerioAPI
): Record<string, string> {
  const map: Record<string, string> = {};

  $(
    ".boxCaracteristicas .c_row, .row_caracteristicas .c_row, table.table tr"
  ).each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length === 2) {
      const key = cleanText($(cells[0]).text());
      const value = cleanText($(cells[1]).text());
      if (key && key.length < 40) map[key] = value;
    } else {
      const key = cleanText($row.find(".item").text());
      const value = cleanText($row.find(".value").text());
      if (key) map[key] = value;
    }
  });

  return map;
}

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

function extractBackgroundUrl(style: string): string {
  const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return match ? resolveUrl(match[1]) : "";
}

// "até 29/07/2026" (DD/MM/YYYY)
function parseEndDate(text: string): Date {
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

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}
