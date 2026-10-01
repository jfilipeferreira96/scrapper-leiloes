import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, parseArea, extractCoordinates } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://capital-leiloeira.pt";

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

// same Virtual Forum engine as leilostar: bem_list cards + bem_detail pages
export function parseCapitalListing(
  html: string
): { items: ListingItem[]; totalPages: number } {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  // each card is a div.property_item wrapping image anchor, icon, price and title
  const $cards = $("div.property_item");
  if ($cards.length > 0) {
    $cards.each((_, el) => {
      const item = extractListingItemFromCard($, $(el));
      if (item) items.push(item);
    });
  } else {
    $('a[href*="bem_detail"]').each((_, el) => {
      const item = extractListingItemFromAnchor($, $(el));
      if (item) items.push(item);
    });
  }

  const totalPages = countListingPages($);

  return { items, totalPages };
}

function extractListingItemFromCard(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  const href = $card.find('a[href*="bem_detail"]').first().attr("href") || "";
  const eventId = href.match(/event_id=(\d+)/)?.[1];
  const id = href.match(/[&?]id=(\d+)/)?.[1];
  if (!eventId || !id) return null;

  const title = cleanText($card.find(".proerty_text h3").first().text());

  // "REF: CL295.1"
  const refText = cleanText($card.find(".proerty_text p").first().text());
  const reference = refText.replace(/^REF:\s*/i, "").trim();

  const styleDiv = $card.find(".image div[style*='background']").first();
  const imgSrc = $card.find(".image img").first().attr("src") || "";
  const image =
    extractBackgroundUrl(styleDiv.attr("style") || "") ||
    (imgSrc ? resolveUrl(imgSrc) : "");

  const $icon = $card.find(".modVendaIconOnList").first();
  const auctionType = cleanText(
    $icon.attr("title") || $icon.attr("data-original-title") || ""
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

function extractListingItemFromAnchor(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  const href = $card.attr("href") || "";
  const eventId = href.match(/event_id=(\d+)/)?.[1];
  const id = href.match(/[&?]id=(\d+)/)?.[1];
  if (!eventId || !id) return null;

  const title = cleanText($card.find(".proerty_text h3").first().text());

  const refText = cleanText($card.find(".proerty_text p").first().text());
  const reference = refText.replace(/^REF:\s*/i, "").trim();

  const styleDiv = $card.find(".image div[style*='background']").first();
  const image = extractBackgroundUrl(styleDiv.attr("style") || "");

  const $icon = $card.find(".modVendaIconOnList").first();
  const auctionType = cleanText(
    $icon.attr("title") || $icon.attr("data-original-title") || ""
  );

  const priceText = cleanText($card.find(".price .tag").first().text());
  const minPrice = extractPriceFromText(priceText);

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

export function parseCapitalDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  const title = cleanText($("#property h2").first().text()) || listing.title;

  const districtH5 = cleanText($("#property h5").first().text());

  const images = extractDetailImages($);

  const chars = buildCharacteristicMap($);

  const minValue = extractRowValue($, "Valor Mínimo");
  const baseValue = extractRowValue($, "Valor Base");
  const price = minValue > 0 ? minValue : baseValue;

  const description = cleanText(
    $(".text-it-p p, .boxDescricao p")
      .map((_, p) => $(p).text())
      .get()
      .join(" ")
  );

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

  const district = chars["Distrito"] || districtH5 || "";
  const municipality = chars["Concelho"] || "";
  const parish = chars["Freguesia"] || "";

  const auctionType = chars["Modalidade de Venda"] || listing.auctionType;

  const publishedAt =
    parseEndDate(chars["Data Fim"] || "") || parseEndDate(listing.endDateText) || new Date();

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

  $("#property-d-1 .item img, #property-d-1-2 .item img, .owl-carousel .item img").each((_, img) => {
    const src = $(img).attr("src");
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });

  return images;
}

// key/value pairs from the Características tables and the c_row variant
function buildCharacteristicMap(
  $: cheerio.CheerioAPI
): Record<string, string> {
  const map: Record<string, string> = {};

  $("#property table.table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 2) {
      const key = cleanText($(cells[0]).text());
      const value = cleanText($(cells[1]).text());
      if (key && key.length < 40) map[key] = value;
    }
  });

  $(".boxCaracteristicas .c_row, .row_caracteristicas .c_row").each((_, row) => {
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
function parseEndDate(text: string): Date | null {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    );
  }
  return null;
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
