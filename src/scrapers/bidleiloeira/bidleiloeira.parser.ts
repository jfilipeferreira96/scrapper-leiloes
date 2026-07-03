import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePortugueseDate, parsePrice, extractCoordinates } from "../../utils/parser.js";

export function parseBidLeiloeiraListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".leiloes_item").each((_, item) => {
    const $item = $(item);
    const itemId = $item.attr("id") || "";
    const idMatch = itemId.match(/item-(\d+)/);
    if (!idMatch) return;
    const externalId = idMatch[1];

    const href = $item.attr("href") || "";
    const url = href.startsWith("http") ? href : `https://www.bidleiloeira.pt/${href}`;

    const title = $item.find(".list_tit").text().trim();
    const description = $item.find(".list_txt").text().trim();
    const descriptionHtml = $item.find(".list_txt").html() || "";

    const statusEl = $item.find(".estado");
    const bgColor = statusEl.attr("style") || "";
    const status = bgColor.includes("#02ce6c") ? "A decorrer" : 
                   bgColor.includes("#d54100") ? "Terminado" : "";

    const dates = extractDates($item);
    const image = extractImage($item);
    const location = extractLocation(descriptionHtml);

    properties.push({
      source: "bidleiloeira",
      externalId,
      title,
      description,
      price: 0,
      location: location || "Localização não especificada",
      auctionType,
      url,
      images: image ? [image] : [],
      status,
      publishedAt: dates.startDate,
    });
  });

  return properties;
}

function extractDates($item: cheerio.Cheerio<any>): { startDate?: Date; endDate?: Date } {
  const result: { startDate?: Date; endDate?: Date } = {};
  
  $item.find(".list_subtit").each((_, el) => {
    const $el = $item._make(el);
    const label = $el.text().trim();
    const dateText = $el.next("h2").text().trim();
    
    if (label.includes("Inicia")) {
      result.startDate = parsePortugueseDate(dateText);
    } else if (label.includes("Termina")) {
      result.endDate = parsePortugueseDate(dateText);
    }
  });
  
  return result;
}


function extractImage($item: cheerio.Cheerio<any>): string | undefined {
  const bgStyle = $item.find(".has_bg").attr("style") || "";
  const match = bgStyle.match(/url\(['"]?([^'"]+)['"]?\)/);
  return match ? match[1] : undefined;
}

function extractLocation(description: string): string | undefined {
  // Try to extract location using regex pattern: "..., <strong>CityName</strong>"
  const match = description.match(/,\s*<strong>([^<]+)<\/strong>$/i);
  if (match) {
    return match[1].trim();
  }

  // Fallback: load as HTML and find last bold element that looks like a city
  const $ = cheerio.load(description);
  const strongElements = $("strong");
  
  for (let i = strongElements.length - 1; i >= 0; i--) {
    const text = $(strongElements[i]).text().trim();
    // Heuristic: city name is usually at end, not too long, not "Rua" or "NOTA"
    if (text && 
        text.length > 2 && 
        text.length < 50 && 
        !text.includes("Rua") && 
        !text.includes("NOTA") &&
        !text.includes("Prédio") &&
        !text.includes("Direito") &&
        !text.includes("Viatura") &&
        !text.includes("Lote")) {
      return text;
    }
  }
  
  return undefined;
}

/**
 * Parses the BidLeiloeira detail page HTML.
 * Enriches the base Property with complete data.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Complete Property with detail data
 */
export function parseBidLeiloeiraDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // Extract location from the detail page (cleaner than listing)
  const location = extractLocationFromDetail($);
  
  // Extract price info from lot cards
  const priceInfo = extractPriceInfo($);

  return {
    ...base,
    price: priceInfo.price,
    openingValue: priceInfo.openingValue,
    minSaleValue: priceInfo.minSaleValue,
    currentBid: priceInfo.currentBid,
    location: location || base.location,
    description: extractDescription($),
    latitude: extractCoordinatesFromIframe($)?.lat,
    longitude: extractCoordinatesFromIframe($)?.lon,
    images: extractGalleryImages($),
  };
}

/**
 * Extracts location from the detail page sidebar.
 */
function extractLocationFromDetail($: cheerio.CheerioAPI): string | undefined {
  let location: string | undefined;
  
  // Look for "Localização" label
  $(".list_subtit").each((_, el) => {
    const $el = $(el);
    if ($el.text().trim().includes("Localização")) {
      location = $el.next(".txt").text().trim();
      return false; // stop each
    }
  });
  
  return location;
}

/**
 * Extracts price information from the detail page.
 * Can extract from lot cards (listing page) or from detailed values (lot page).
 */
function extractPriceInfo($: cheerio.CheerioAPI): {
  price: number;
  openingValue: number | undefined;
  minSaleValue: number | undefined;
  currentBid: number | undefined;
} {
  const result = {
    price: 0,
    openingValue: undefined as number | undefined,
    minSaleValue: undefined as number | undefined,
    currentBid: undefined as number | undefined,
  };

  // Try to extract from lot cards (listing page style)
  $(".leiloes_lotes_divs").each((_, el) => {
    const $lot = $(el);
    const $h4 = $lot.find("h4");
    
    if ($h4.length > 0) {
      const label = $h4.text().trim();
      const priceText = $lot.find("span").first().text().trim();
      const value = parsePrice(priceText);
      
      if (label.includes("Licitação Final")) {
        result.price = value;
      } else if (label.includes("Valor abertura") || label.includes("Valor de Abertura")) {
        result.openingValue = value;
        result.price = value; // Use opening value as main price if no final bid
      }
    }
  });

  // Try to extract from detailed values grid (lot page style)
  const $valoresGrid = $(".mais_tit").filter(function() {
    return $(this).text().trim() === "Valores";
  });
  
  if ($valoresGrid.length > 0) {
    const $grid = $valoresGrid.next();
    const values = $grid.find(".txt.mais_tit");
    
    if (values.length >= 3) {
      // Grid has: Base | Mínimo | Abertura
      const basePrice = parsePrice(values.eq(0).text());
      const minPrice = parsePrice(values.eq(1).text());
      const openingPrice = parsePrice(values.eq(2).text());
      
      result.minSaleValue = minPrice;
      result.openingValue = openingPrice;
      result.price = openingPrice; // Use opening as main price
    }
  }

  return result;
}

/**
 * Extracts coordinates from the Google Maps iframe.
 */
function extractCoordinatesFromIframe($: cheerio.CheerioAPI): { lat: number; lon: number } | undefined {
  const iframe = $("#mapa iframe");
  if (iframe.length === 0) return undefined;

  const src = iframe.attr("src") || "";
  return extractCoordinates(src);
}

/**
 * Extracts the description from the detail page.
 */
function extractDescription($: cheerio.CheerioAPI): string | undefined {
  const desc = $(".leilao_info .desc").text().trim();
  return desc || undefined;
}

/**
 * Extracts all images from the gallery.
 */
function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  
  // Gallery items: <a class="item has_bg" href="...">
  $("#div_imagem .item").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.startsWith("http")) {
      images.push(href);
    }
  });
  
  // Also check for images in lot items
  $(".leiloes_lotes_divs .img.has_bg").each((_, el) => {
    const bgStyle = $(el).attr("style") || "";
    const match = bgStyle.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (match && match[1].startsWith("http")) {
      images.push(match[1]);
    }
  });
  
  return [...new Set(images)];
}

