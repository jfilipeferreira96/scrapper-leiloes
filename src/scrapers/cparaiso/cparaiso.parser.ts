import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice, parsePortugueseDate } from "../../utils/parser.js";

const BASE_URL = "https://cparaiso.pt";

export function parseCparaisoListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".auction-grid .slide > li").each((_, item) => {
    const $item = $(item);

    const $link = $item.find(".image > a.img").first();
    const href = $link.attr("href") || "";
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    if (!url) return;

    // externalId only appears on the detail page, so it's empty here
    const externalId = "";

    const title = $item.find(".content h2 a").first().attr("title")?.trim() || "";

    const imgSrc = $item.find(".image > a.img > img").first().attr("src") || "";
    const image = imgSrc ? (imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`) : undefined;

    // auction type is the alt text of the type image
    const auctionTypeImg = $item.find(".lot-auction-type-container img").first().attr("alt") || "";
    const auctionType = auctionTypeImg === "Leilão Online" ? "Leilão Online" :
                        auctionTypeImg === "Negociação Particular" ? "Negociação Particular" :
                        undefined;

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

export function parseCparaisoDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // Format: "Lote 100507"
  const refText = $(".lot-ref").first().text().trim();
  const externalId = refText.replace("Lote", "").trim() || base.externalId;

  const title = $("h1").first().text().trim() || base.title;

  // images are the full-size fancybox links
  const images = extractImages($);

  // use the nested .description; the top-level one contains cookie info
  const descriptionEl = $(".tab-content.description .description").first();
  const description = descriptionEl.text().trim() || base.description;

  // Format: "Concelho: Mação"
  const locationText = $(".lot-details p").first().text().trim();
  const municipality = locationText.replace("Concelho:", "").trim() || undefined;
  const location = municipality || base.location;

  // fall back to the quick bid values if Valor Inicial is missing
  let priceText = $(".amount.primary-currency").first().text().trim();
  let price = parsePrice(priceText);
  
  if (price === 0) {
    const quickBidText = $("#auto_licitation li").first().text().trim();
    price = parsePrice(quickBidText);
  }

  const statusLabel = $(".countdown-label").first().text().trim();
  const status = statusLabel || base.status;

  // title format: "... - Freguesia e Concelho de MAÇÃO, Distrito SANTARÉM"
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

function parseEndDate(text: string): Date | undefined {
  if (!text) return undefined;
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

function extractDistrict(title: string): string | undefined {
  if (!title) return undefined;
  const match = title.match(/Distrito\s+([A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ]+)/i);
  return match ? match[1] : undefined;
}