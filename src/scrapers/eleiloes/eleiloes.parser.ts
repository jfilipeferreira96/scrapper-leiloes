import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

const BASE_URL = "https://www.e-leiloes.pt";

export interface ListingItem {
  externalId: string;
  url: string;
  title: string;
}

// the site is a Vue SPA: rendered lots appear as text (LO1511542026) without
// regular anchors, so ids are pulled straight from the rendered HTML
export function parseEleiloesListing(html: string): ListingItem[] {
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  const $ = cheerio.load(html);

  $('a[href*="/evento/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const idMatch = href.match(/\/evento\/([A-Za-z0-9]+)/);
    if (idMatch && !seen.has(idMatch[1])) {
      seen.add(idMatch[1]);
      items.push({
        externalId: idMatch[1],
        url: resolveUrl(href),
        title: cleanText($(el).text()) || idMatch[1],
      });
    }
  });

  const idRegex = /\bLO\d{6,}\b/g;
  const matches = html.match(idRegex) || [];
  for (const externalId of matches) {
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    items.push({
      externalId,
      url: `${BASE_URL}/evento/${externalId}`,
      title: externalId,
    });
  }

  return items;
}

// the detail is a Vue SPA too; fields come from label/value span pairs and
// value blocks like "Valor Base:120 000,00 €" (space as thousands separator)
export function parseEleiloesDetail(html: string, base: { title: string }): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const title = cleanText($("span.font-bold.text-primary-800").first().text());
  result.title = title || base.title;

  const bodyText = cleanText($("body").text());

  const money = (label: string): number => {
    const match = bodyText.match(new RegExp(`${label}:?\\s*([\\d\\s.,]+,\\d{2})\\s*€`));
    return match ? parsePrice(match[1]) : 0;
  };

  const opening = money("Valor Abertura");
  const baseValue = money("Valor Base");
  const min = money("Valor Mínimo");
  const bid = money("Lance Atual");

  result.openingValue = opening > 0 ? opening : baseValue > 0 ? baseValue : undefined;
  result.minSaleValue = min > 0 ? min : undefined;
  result.currentBid = bid > 0 ? bid : undefined;
  result.price = bid > 0 ? bid : baseValue > 0 ? baseValue : opening > 0 ? opening : min > 0 ? min : 0;

  const fieldText = (label: string): string => {
    let out = "";
    $("span.font-semibold").each((_, el) => {
      if (out) return;
      const text = cleanText($(el).text()).replace(/:$/, "");
      if (text === label) {
        out = cleanText($(el).next("span").text());
      }
    });
    return out;
  };

  const latStr = fieldText("GPS Latitude");
  const lonStr = fieldText("GPS Longitude");
  if (latStr && lonStr) {
    const lat = parseFloat(latStr.replace(",", "."));
    const lon = parseFloat(lonStr.replace(",", "."));
    if (!isNaN(lat) && !isNaN(lon)) {
      result.latitude = lat;
      result.longitude = lon;
    }
  }

  const stripCode = (value: string): string => value.replace(/^\d+\s*-\s*/, "");

  const district = stripCode(fieldText("Distrito"));
  const municipality = stripCode(fieldText("Concelho"));
  const parish = stripCode(fieldText("Freguesia"));
  if (district) result.district = district;
  if (municipality) result.municipality = municipality;
  if (parish) result.parish = parish;

  const markerText = cleanText($("i.pi-map-marker").first().next("span").text());
  if (markerText) {
    result.location = markerText;
  } else if (district) {
    result.location = [municipality, district].filter(Boolean).join(", ");
  }

  const images: string[] = [];
  const seen = new Set<string>();
  $("img").each((_, img) => {
    const src = $(img).attr("src") || "";
    if (src && !src.includes("logo") && !src.includes("icon") && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });
  if (images.length > 0) result.images = images;

  let description = "";
  $("div").each((_, el) => {
    if (description) return;
    if (cleanText($(el).text()) === "Descrição") {
      description = cleanText($(el).parent().next("div").text());
    }
  });

  const processo = fieldText("Processo");
  if (processo) {
    description = `${description}\n\nProcesso: ${processo}`.trim();
  }
  if (description) {
    result.description = description;
  }

  return result;
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
