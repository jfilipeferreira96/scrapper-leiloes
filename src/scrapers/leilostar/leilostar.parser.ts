import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, parseArea, extractCoordinates } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://www.leilostar.pt";

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

export function parseLeilostarListing(
  html: string
): { items: ListingItem[]; totalPages: number } {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  // each card is wrapped in an <a href="index.php?page=bem_detail&...">
  $('a[href*="bem_detail"]').each((_, el) => {
    const $el = $(el);
    const item = extractListingItem($, $el);
    if (item) items.push(item);
  });

  const totalPages = countListingPages($);

  return { items, totalPages };
}

function extractListingItem(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  const href = $card.attr("href") || "";
  const eventId = href.match(/event_id=(\d+)/)?.[1];
  const id = href.match(/[&?]id=(\d+)/)?.[1];
  if (!eventId || !id) return null;

  const title = cleanText($card.find(".proerty_text h3 div").first().text());

  // "REF: 327MON2026"
  const refText = cleanText($card.find(".proerty_text p").first().text());
  const reference = refText.replace(/^REF:\s*/i, "").trim();

  const styleDiv = $card.find(".image div[style*='background']").first();
  const image = extractBackgroundUrl(styleDiv.attr("style") || "");

  const auctionType = cleanText(
    $card.find(".modVendaIconOnList").attr("data-original-title") || ""
  );

  // "Valor Mínimo: 20.060,00 €"
  const priceText = cleanText($card.find(".price .tag").first().text());
  const minPrice = extractPriceFromText(priceText);

  // "até 29/07/2026"
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

function countListingPages($: cheerio.CheerioAPI): number {
  const $pages = $("ul.pager li");
  if ($pages.length > 0) return $pages.length;
  return 1;
}

export function parseLeilostarDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  // detail page has the full title
  const title = cleanText($("#property h2").first().text()) || listing.title;

  const districtH5 = cleanText($("#property h5").first().text());

  const images = extractDetailImages($);

  const chars = buildCharacteristicMap($);

  const minValue = extractRowValue($, "Valor Mínimo");
  const baseValue = extractRowValue($, "Valor Base");
  const price = minValue > 0 ? minValue : baseValue;

  const description = cleanText($(".boxDescricao p").first().text());

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

  const area = parseArea(chars["Área Total"]) || parseArea(chars["Área Construção"]);

  const district = chars["Distrito"] || districtH5 || "";
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

  $("#property-d-1 .owl-item .item img").each((_, img) => {
    const src = $(img).attr("src");
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });

  return images;
}

// key/value pairs from the Características and Localização boxes
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

function extractPriceFromText(text: string): number {
  const match = text.match(/([\d.,]+)\s*€/);
  return match ? parsePrice(match[1]) : 0;
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
