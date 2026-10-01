import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice, parseArea } from "../../utils/parser.js";

const BASE_URL = "https://euroestates.pt";

export interface ListingItem {
  externalId: string;
  url: string;
  reference: string;
  title: string;
  price: number;
  image: string;
  areaText: string;
  usageType: string;
  typology: string;
  location: string;
  status: string;
}

export function parseEuroestatesListing(html: string): ListingItem[] {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  // only the main listing grid; the featured sidebar reuses the same view links
  $("#property-listing .property-listing-row .business-block").each((_, el) => {
    const $card = $(el);

    const link = $card.find('a[href*="/realestate/view/"]').first().attr("href") || "";
    const idMatch = link.match(/\/realestate\/view\/(\d+)/);
    if (!idMatch) return;
    const externalId = idMatch[1];
    if (seen.has(externalId)) return;
    seen.add(externalId);

    const reference = cleanText(
      $card.find(".property-details a").first().text()
    ).replace(/^Refer[êe]ncia:\s*/i, "");

    const priceText = cleanText($card.find(".property-images-box h4").first().text());
    const price = parsePrice(priceText);

    const imgSrc = $card.find(".property-images-box img").first().attr("src") || "";

    const bullets: string[] = [];
    $card.find(".property-details ul li").each((_, li) => {
      bullets.push(cleanText($(li).text()));
    });

    const status = cleanText($card.find(".badge h4").first().text());
    // Destaque/Oportunidade are marketing labels, not statuses
    const realStatus = ["Arrendado", "Vendido"].includes(status) ? status : "active";

    items.push({
      externalId,
      url: resolveUrl(link),
      reference,
      title: reference,
      price,
      image: imgSrc ? resolveUrl(imgSrc) : "",
      areaText: parseArea(bullets[0]) !== undefined ? bullets[0] : "",
      usageType: bullets[1] || "",
      typology: bullets[2] || "",
      location: bullets[bullets.length - 1] || "",
      status: realStatus,
    });
  });

  return items;
}

export function parseEuroestatesDetail(
  html: string,
  base: ListingItem
): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const headerEl = $(".property-header h3").first().clone();
  headerEl.children().remove();
  const headerText = cleanText(headerEl.text());
  const refFromHeader = headerText.match(/Refer[êe]ncia:\s*([^-]+)/i)?.[1]?.trim();
  const title = refFromHeader || base.reference;

  const locationFromHeader = headerText.split("-").slice(1).join("-").trim();

  const headerBullets: string[] = [];
  $(".property-header ul li").each((_, li) => {
    headerBullets.push(cleanText($(li).text()));
  });

  let price = base.price;
  let area: number | undefined;
  let location = base.location;

  headerBullets.forEach((bullet) => {
    const parsed = parsePrice(bullet);
    if (parsed > 0 && price === 0) {
      price = parsed;
    }
    if (bullet.includes("m²") || bullet.includes("m&sup2;")) {
      const parsedArea = parseArea(bullet);
      if (parsedArea !== undefined && area === undefined) {
        area = parsedArea;
      }
    }
    if (bullet.includes(",")) {
      location = bullet;
    }
  });

  const businessType = cleanText($(".property-header span.SALE, .property-header span.RENT").first().text());

  const featureChars: Record<string, string> = {};
  $(".single-property-details table.table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length === 2) {
      featureChars[cleanText($(cells[0]).text())] = cleanText($(cells[1]).text());
    }
  });

  const images: string[] = [];
  const seen = new Set<string>();
  $("#property-detail1-slider .carousel-inner img").each((_, img) => {
    const src = $(img).attr("src") || "";
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });

  const sections: string[] = [];
  $(".single-property-details h3").each((_, h3) => {
    const sectionName = cleanText($(h3).text());
    const paragraphs: string[] = [];
    $(h3).nextUntil("h3", "p").each((_, p) => {
      const text = cleanText($(p).text());
      if (text) paragraphs.push(text);
    });
    if (paragraphs.length > 0 && sectionName !== "Características") {
      sections.push(`${sectionName}: ${paragraphs.join(" ")}`);
    }
  });

  const address = cleanText($(".property-direction h4 span").first().text());
  if (address) {
    sections.push(`Morada: ${address}`);
  }

  result.title = title;
  result.price = price;
  result.area = parseArea(featureChars["Área"]) ?? area ?? parseArea(base.areaText);
  result.location = locationFromHeader || location;
  result.description = sections.join("\n\n");
  result.images = images.length > 0 ? images : base.image ? [base.image] : [];
  result.auctionType = businessType || "Venda";
  result.status = base.status;

  if (locationFromHeader) {
    const parts = locationFromHeader.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      result.parish = parts[0];
      result.municipality = parts[1];
      if (parts.length >= 3) result.district = parts[2];
    }
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
