import * as cheerio from "cheerio";
import { parsePrice } from "../../utils/parser.js";
import { Property } from "../../models/property.js";

const BASE_URL = "https://www.caixaimobiliario.pt";

// location examples:
// "Espanha - RUA CURROS ENRIQUEZ, Nº 2, 2.ºB (Pontevedra)" (foreign)
// "R Outeiro do Pocinho, 55 Rs-do-cho, 7875 - 382 SOBRAL DA ADIA"
// "Rio Maior"
function parseLocation(locationStr: string): { city?: string; district?: string } {
  if (locationStr.includes(' - ')) {
    const parts = locationStr.split(' - ').map(p => p.trim());
    if (parts.length >= 2) {
      return {
        city: parts[1].split(',')[0].trim(),
        district: parts[0],
      };
    }
  }

  // "Street, Number Floor, Postal Code - City"
  const postalCodeMatch = locationStr.match(/(\d{4})\s*-\s*(\d{3})\s+(.+)/);
  if (postalCodeMatch) {
    return {
      city: postalCodeMatch[3].trim(),
      district: undefined,
    };
  }

  return {
    city: locationStr.split(',')[0].trim(),
    district: undefined,
  };
}

export function parseCaixaimobiliarioListing(element: any): Partial<Property> | null {
  const $ = cheerio.load(element);

  const fullText = $.text();
  if (fullText.includes("Estrangeiro")) {
    return null;
  }

  const title = $(".dados_tipo a").first().text().trim().split("Preço Sob Consulta")[0].trim();

  const priceText = $(".dados_tipo a").first().text();
  const priceMatch = priceText.match(/([\d.,]+)\s*€/);
  const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

  const reference = $(".dados_referencia").text().trim().replace("Ref. ", "");
  const externalId = reference || "";

  const image = $(".dados_foto img").attr("src") || "";

  const detailUrl = $(".dados_tipo a").attr("href") || "";

  const locationText = $(".dados_txt_comprar span").first().text().trim();
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

// h1 format: "Title | City | 30.000 €"
export function parseCaixaimobiliarioDetail(html: string, baseUrl: string): Partial<Property> {
  const $ = cheerio.load(html);

  const titleText = $("h1 div").first().text().trim();
  const titleParts = titleText.split("|").map((p) => p.trim());
  const title = titleParts[0] || "";

  const priceMatch = titleText.match(/([\d.,]+)\s*€/);
  const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

  const reference = $(".tab_id_ref-social p").text().trim().replace("Ref. ", "");

  const description = $(".mod_caract p")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("\n\n");

  const addressText = $(".tab_id_descricao p").first().text().trim();
  const addressLines = addressText.split("\n").map((l) => l.trim());
  const address = addressLines[0] || "";
  const city = addressLines[1] || "";

  const images: string[] = [];
  $(".mod_detalhe1_img img, .mod_imovel_img img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      images.push(src.startsWith("http") ? src : `https://www.caixaimobiliario.pt${src}`);
    }
  });

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

  const location = parseLocation(addressText);

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
