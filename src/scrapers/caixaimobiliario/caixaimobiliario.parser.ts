import * as cheerio from "cheerio";
import { parsePrice } from "../../utils/parser.js";
import { Property } from "../../models/property.js";

const BASE_URL = "https://www.caixaimobiliario.pt";

/**
 * Parses location string to extract city and district
 */
function parseLocation(locationStr: string): { city?: string; district?: string } {
  // Format: "Espanha - RUA CURROS ENRIQUEZ, Nº 2, 2.ºB (Pontevedra)"
  // or "R Outeiro do Pocinho, 55 Rs-do-cho, 7875 - 382 SOBRAL DA ADIA"
  // or "Rio Maior"
  
  // Check for country separator (foreign properties)
  if (locationStr.includes(' - ')) {
    const parts = locationStr.split(' - ').map(p => p.trim());
    if (parts.length >= 2) {
      return {
        city: parts[1].split(',')[0].trim(),
        district: parts[0], // Country as district
      };
    }
  }
  
  // Parse Portuguese address format
  // Format: "Street, Number Floor, Postal Code - City"
  const postalCodeMatch = locationStr.match(/(\d{4})\s*-\s*(\d{3})\s+(.+)/);
  if (postalCodeMatch) {
    const city = postalCodeMatch[3].trim();
    return {
      city,
      district: undefined, // Would need to map city to district
    };
  }
  
  // Simple format: just city name or address
  return {
    city: locationStr.split(',')[0].trim(),
    district: undefined,
  };
}

/**
 * Parse a single listing from the Caixa Imobiliário listing page
 * @param element Cheerio element containing the listing
 * @returns Partial property object or null if it's a foreign property
 */
export function parseCaixaimobiliarioListing(element: any): Partial<Property> | null {
  const $ = cheerio.load(element);

  // Check if this is a foreign property (contains "Estrangeiro")
  const fullText = $.text();
  if (fullText.includes("Estrangeiro")) {
    return null; // Skip foreign properties
  }

  // Extract title
  const title = $(".dados_tipo a").first().text().trim().split("Preço Sob Consulta")[0].trim();

  // Extract price (from the same element as title)
  const priceText = $(".dados_tipo a").first().text();
  // Try multiple price formats: "30.000 €" or "30.000,00 €"
  const priceMatch = priceText.match(/([\d.,]+)\s*€/);
  const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

  // Extract externalId from reference
  const reference = $(".dados_referencia").text().trim().replace("Ref. ", "");
  const externalId = reference || "";

  // Extract image
  const image = $(".dados_foto img").attr("src") || "";

  // Extract detail URL
  const detailUrl = $(".dados_tipo a").attr("href") || "";

  // Extract location (from span after reference)
  const locationText = $(".dados_txt_comprar span").first().text().trim();
  
  // Parse location to extract city and district
  const location = parseLocation(locationText);

  return {
    title,
    price,
    externalId,
    url: detailUrl.startsWith("http") ? detailUrl : `${BASE_URL}${detailUrl}`,
    location: locationText,
    municipality: location.city,
    district: location.district,
    auctionType: "Venda Direta",
    source: "caixaimobiliario",
    images: image ? [image] : [],
  };
}

/**
 * Parse detail page data
 * @param html HTML content of the detail page
 * @param baseUrl Base URL for resolving relative links
 * @returns Partial property object with detailed information
 */
export function parseCaixaimobiliarioDetail(html: string, baseUrl: string): Partial<Property> {
  const $ = cheerio.load(html);

  // Extract title from h1 div (format: "Title | City | Price")
  const titleText = $("h1 div").first().text().trim();
  const titleParts = titleText.split("|").map((p) => p.trim());
  const title = titleParts[0] || "";
  
  // Extract price from title (format: "Title | City | 30.000 €")
  const priceMatch = titleText.match(/([\d.,]+)\s*€/);
  const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

  // Extract externalId from reference
  const reference = $(".tab_id_ref-social p").text().trim().replace("Ref. ", "");

  // Extract description (multiple paragraphs)
  const description = $(".mod_caract p")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("\n\n");

  // Extract address and city
  const addressText = $(".tab_id_descricao p").first().text().trim();
  const addressLines = addressText.split("\n").map((l) => l.trim());
  const address = addressLines[0] || "";
  const city = addressLines[1] || "";

  // Extract images from gallery
  const images: string[] = [];
  $(".mod_detalhe1_img img, .mod_imovel_img img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      images.push(src.startsWith("http") ? src : `https://www.caixaimobiliario.pt${src}`);
    }
  });

  // Extract configuration details (area, condo fee, etc.)
  const configLines = $(".config_linha1").map((_, el) => $(el).text().trim()).get();
  let area = 0;
  let condoFee = 0;

  configLines.forEach((line) => {
    const areaMatch = line.match(/Área bruta de ([\d.]+)\s*m²/i);
    if (areaMatch) {
      area = parseFloat(areaMatch[1].replace(/\./g, "").replace(",", "."));
    }

    const condoMatch = line.match(/Valor de Condomínio\s*\(€\):\s*([\d.]+,\d+)/);
    if (condoMatch) {
      condoFee = parsePrice(condoMatch[1]);
    }
  });

  // Parse location for district
  const location = parseLocation(addressText);

  // Build enhanced description with configuration details
  let enhancedDescription = description || "";
  if (area > 0) {
    enhancedDescription += `\n\nÁrea bruta: ${area} m²`;
  }
  if (condoFee > 0) {
    enhancedDescription += `\nValor de Condomínio: ${condoFee.toFixed(2)} €`;
  }

  return {
    title,
    price,
    externalId: reference,
    description: enhancedDescription,
    location: address,
    municipality: city,
    district: location.district,
    images,
    area,
    auctionType: "Venda Direta",
    source: "caixaimobiliario",
  };
}

/**
 * Extract all listings from the listing page
 * @param html HTML content of the listing page
 * @returns Array of partial property objects
 */
export function extractCaixaimobiliarioListings(html: string): Partial<Property>[] {
  const $ = cheerio.load(html);
  const listings: Partial<Property>[] = [];

  $("#central .dados_imov").each((_, element) => {
    const listing = parseCaixaimobiliarioListing(element);
    if (listing) {
      listings.push(listing);
    }
  });

  return listings;
}