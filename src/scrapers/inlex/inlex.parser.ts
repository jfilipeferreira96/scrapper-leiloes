// "Leilão Eletrônico" pages have full data (prices, dates, GPS, images);
// "Negociação" pages have minimal data (no prices, "Brevemente" status).

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice, extractCoordinates } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://www.inlexleiloeira.pt";
const MAX_IMAGES = 20;

export interface ListingItem {
  id: string;
  url: string;
  title: string;
  image: string;
  location: string;
  auctionType: string;
}

export function parseInlexListing(
  html: string
): { items: ListingItem[]; totalPages: number } {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  // cards carry the detail URL in an onclick attribute
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

function extractListingItem(
  $: cheerio.CheerioAPI,
  $card: CheerioEl
): ListingItem | null {
  const onclick = $card.attr("onclick") || "";
  const href = $card.find("a.homes-img").attr("href") || "";
  const path = onclick || href;
  const idMatch = path.match(/\/verba\/(\d+)/);
  if (!idMatch) return null;
  const id = idMatch[1];

  const urlPath = onclick.match(/location\.href='([^']+)'/)?.[1] || href;
  if (!urlPath) return null;

  const title = cleanText(
    $card.find("h3.c-verba-individual-title a").first().attr("title") || ""
  ) || cleanText($card.find("h3.c-verba-individual-title").first().text());

  const image = resolveUrl(
    $card.find("img.img-responsive").attr("src") || ""
  );

  const location = cleanText(
    $card.find("p.homes-address span").first().text()
  );

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

export function parseInlexDetail(
  html: string,
  listing: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);

  const detailTitle = cleanText(
    $('b[style*="#7c814f"]').first().text()
  );
  const title = detailTitle || listing.title;

  const images = extractDetailImages($, listing.image);

  const sidebarHeading = cleanText(
    $(".widget-boxed-header h4").first().text()
  );
  const auctionType = sidebarHeading.includes("Negociação")
    ? "Negociação"
    : sidebarHeading.includes("Leilão")
      ? "Leilão Eletrônico"
      : listing.auctionType;

  const valorBase = extractSidebarValue($, "Valor Base");
  const valorAbertura = extractSidebarValue($, "Valor Abertura");
  const valorMinimo = extractSidebarValue($, "Valor Mínimo Venda");

  const baseValue = parsePrice(valorBase);
  const openingValue = parsePrice(valorAbertura);
  const minValue = parsePrice(valorMinimo);

  const price = minValue > 0 ? minValue : baseValue;

  const coords = extractGps($);

  const description = extractDescription($);

  const publishedAt = extractEndDateFromJs(html);

  const [parish, municipality] = parseLocationParts(listing.location);

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

function extractDetailImages(
  $: cheerio.CheerioAPI,
  fallbackImage: string
): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  $(".row.gallery-item a[href*='_bigger']").each((_, a) => {
    if (images.length >= MAX_IMAGES) return;
    const href = $(a).attr("href") || "";
    if (href && !seen.has(href)) {
      seen.add(href);
      images.push(resolveUrl(href));
    }
  });

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

  if (images.length === 0 && fallbackImage) {
    images.push(fallbackImage);
  }

  return images;
}

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

function extractGps(
  $: cheerio.CheerioAPI
): { lat: number; lon: number } | undefined {
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

  const iframeSrc = $('iframe[src*="maps.google.com"]').attr("src") || "";
  return extractCoordinates(iframeSrc);
}

function extractDescription($: cheerio.CheerioAPI): string {
  const $box = $(".c-tabs-box-main").first().clone();
  if ($box.length === 0) return "";

  $box.find(".c-verba-description-item").remove();
  $box.find(".c-verba-share-box").remove();
  $box.find('b[style*="#7c814f"]').remove();
  $box.find(".row").remove();

  return cleanText($box.text());
}

function extractPropertyType($: cheerio.CheerioAPI): string {
  let type = "";
  $(".c-verba-description-item").each((_, el) => {
    const $el = $(el);
    const bText = cleanText($el.find("b").text());
    if (bText.includes("Tipo:")) {
      const fullText = cleanText($el.text());
      type = fullText.replace(/^Tipo:\s*/i, "").trim();
    }
  });
  return type;
}

// page embeds: var end = new Date(Y,M,D,H,m,s) with 0-indexed month
function extractEndDateFromJs(html: string): Date {
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

function parseLocationParts(location: string): [string, string] {
  const parts = location.split(",").map((s) => s.trim());
  const parish = parts[0] || "";
  const municipality = parts[1] || "";
  return [parish, municipality];
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
