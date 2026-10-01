/**
 * Solventium Parser.
 *
 * Auction types come from the ?tipo=N query param (see AUCTION_TYPE_LABELS).
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

const BASE_URL = "https://www.solventium.pt";

/** Maps the ?tipo= query param to a human-readable auction type. */
export const AUCTION_TYPE_LABELS: Record<number, string> = {
  1: "Leilão Presencial",
  2: "Leilão Electrónico",
  5: "Negociação Particular",
  6: "Carta Fechada",
  7: "Vendas Particulares",
  10: "Brevemente",
};

export function parseSolventiumListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".lista_vendas .post_content.clearfix").each((_, item) => {
    const $item = $(item);

    // Link looks like ./?page=leilao&leilao=469&venda=372&tipo=2
    const detailHref = $item.find("#item_foto a").attr("href") || 
                       $item.find(".pesquisa_titulo a").attr("href") || "";
    const url = buildAbsoluteUrl(detailHref);

    const leilaoMatch = detailHref.match(/leilao=(\d+)/);
    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = leilaoMatch ? leilaoMatch[1] : "";
    if (!externalId) return;

    const textoLote = $item.find(".texto_lote").text().trim();
    const title = extractTitleFromTextoLote(textoLote);

    const location = extractLocationFromTextoLote(textoLote);

    const description = extractDescriptionFromTextoLote(textoLote);

    const imgSrc = $item.find("#item_foto img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    const auctionTypeFromPage = $item.find(".tipo_leilao_pesq").text().trim() || auctionType;

    const minText = $item.find(".infobox_valores_pesq .infobox_valorbase p").first().text().trim();
    const minSaleValue = parsePrice(minText);
    
    const currentBidText = $item.find(".infobox_valores_pesq .infobox_valoractual p").text().trim();
    const currentBid = currentBidText.toLowerCase().includes("sem lances") ? 0 : parsePrice(currentBidText);
    
    const price = currentBid || minSaleValue || 0;

    // Check if #leilao_terminado-{id} is visible (not display:none)
    const leilaoId = externalId;
    const $terminado = $item.find(`#leilao_terminado-${leilaoId}`);
    let status = "A decorrer";
    if ($terminado.length > 0 && $terminado.attr("style")?.includes("display:none") === false) {
      status = "VENDA TERMINADA";
    }

    const processoMatch = textoLote.match(/Processo:\s*([^\n<]+)/);
    const processo = processoMatch ? processoMatch[1].trim() : "";
    const finalDescription = processo ? `${description}\n\nProcesso: ${processo}` : description;

    properties.push({
      source: "solventium",
      externalId,
      title,
      description: finalDescription,
      price,
      minSaleValue: minSaleValue || undefined,
      currentBid: currentBid || undefined,
      location: location || "Localização não especificada",
      auctionType: auctionTypeFromPage,
      url,
      images: image ? [image] : [],
      status,
    });
  });

  return properties;
}

export function parseSolventiumDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  const images = extractGalleryImages($);

  // Detail page has cleaner text
  const description =
    $(".detalhe_verba .post_content.pesquisa_titulo").text().trim() || base.description;

  const location = description ? extractLocationFromDescription(description) : undefined;
  const finalLocation = location || base.location;

  // Detail page shows Valor de Venda / Valor Minimo / Valor Abertura / Valor Actual
  const priceInfo = extractDetailPrices($);

  const price = priceInfo.currentBid || priceInfo.openingValue || base.price;

  const { district, municipality } = parseLocation(finalLocation || "");

  return {
    ...base,
    description: description || "",
    price,
    openingValue: priceInfo.openingValue,
    minSaleValue: priceInfo.minSaleValue,
    currentBid: priceInfo.currentBid,
    location: finalLocation || "Localização não especificada",
    district,
    municipality,
    images: images.length > 0 ? images : base.images,
  };
}

function buildAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("./")) href = href.substring(2);
  return `${BASE_URL}/${href}`;
}

function extractTitleFromTextoLote(text: string): string {
  if (!text) return "";
  const cleanText = text.replace(/<[^>]*>/g, "").trim();
  const lines = cleanText.split("\n").map(l => l.trim()).filter(l => l);
  if (lines.length > 0) {
    return lines[0].substring(0, 200);
  }
  return "Sem título";
}

/** Location patterns: "Coruche", "Aradas - Aveiro", "Peniche". */
function extractLocationFromTextoLote(text: string): string | undefined {
  if (!text) return undefined;
  
  const cleanText = text.replace(/<[^>]*>/g, " ");
  
  const dashMatch = cleanText.match(/-\s*([A-Z][A-Za-z\s]+)(?:\s*$|<br)/);
  if (dashMatch) {
    return dashMatch[1].trim();
  }
  
  const cityMatch = cleanText.match(/\b([A-Z][A-Z\s]+)\b/);
  if (cityMatch) {
    return cityMatch[1].trim();
  }
  
  return undefined;
}

function extractDescriptionFromTextoLote(text: string): string {
  if (!text) return "";
  
  let cleanText = text.replace(/<[^>]*>/g, "\n");
  
  cleanText = cleanText.replace(/Visitas:.*$/gm, "");
  
  cleanText = cleanText.replace(/Processo:.*$/gm, "");
  
  cleanText = cleanText.replace(/Nota:.*$/gm, "");
  
  cleanText = cleanText.replace(/Endereço para propostas:.*$/gm, "");
  
  cleanText = cleanText.replace(/\n\s*\n/g, "\n\n").trim();
  
  return cleanText;
}

function extractLocationFromDescription(text: string): string | undefined {
  if (!text) return undefined;
  
  const match = text.match(/Localização:\s*([^<\n]+)/i);
  if (match) {
    return match[1].trim();
  }
  
  return undefined;
}

function extractGalleryImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  $("#imageGallery li img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      images.push(src.startsWith("http") ? src : buildAbsoluteUrl(src));
    }
  });
  return Array.from(new Set(images));
}

function extractDetailPrices($: cheerio.CheerioAPI): {
  openingValue: number | undefined;
  minSaleValue: number | undefined;
  currentBid: number | undefined;
} {
  const result = {
    openingValue: undefined as number | undefined,
    minSaleValue: undefined as number | undefined,
    currentBid: undefined as number | undefined,
  };

  // The detail page has multiple .infobox_valorbase blocks with <small> labels.
  $(".infobox_valores .infobox_valorbase, .infobox_valores .infobox_valoractual").each((_, el) => {
    const $el = $(el);
    const label = $el.find("small").text().trim().toLowerCase();
    const value = parsePrice($el.find("p").text());

    if (label.includes("abertura")) {
      result.openingValue = value;
    } else if (label.includes("minimo") || label.includes("mínimo")) {
      result.minSaleValue = value;
    } else if (label.includes("venda") && !label.includes("minimo")) {
      // "Valor de Venda" - could be opening value
      if (result.openingValue === undefined) {
        result.openingValue = value;
      }
    } else if (label.includes("actual") || label.includes("atual")) {
      result.currentBid = value;
    }
  });

  const $valorActual = $("#valor-actual");
  if ($valorActual.length > 0) {
    const text = $valorActual.text().trim();
    if (!text.toLowerCase().includes("sem licitações")) {
      result.currentBid = parsePrice(text);
    }
  }

  return result;
}

/** Location formats: "CORUCHE", "ARADAS - AVEIRO", "PENICHE". */
function parseLocation(location: string): {
  district: string | undefined;
  municipality: string | undefined;
} {
  if (!location) {
    return { district: undefined, municipality: undefined };
  }

  const parts = location.split(/[-•]/).map(p => p.trim());
  
  if (parts.length >= 2) {
    return {
      municipality: parts[0] || undefined,
      district: parts[1] || undefined,
    };
  } else if (parts.length === 1) {
    // Single location - assume it's municipality
    return {
      municipality: parts[0] || undefined,
      district: undefined,
    };
  }
  
  return {
    district: undefined,
    municipality: undefined,
  };
}