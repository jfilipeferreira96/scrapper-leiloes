/**
 * Solventium Parser.
 *
 * Parses listing and detail pages from www.solventium.pt.
 *
 * Auction types (param ?tipo=N):
 *   1 → Leilão Presencial
 *   2 → Leilão Electrónico
 *   5 → Negociação Particular
 *   6 → Carta Fechada
 *   7 → Vendas Particulares
 *   10 → Brevemente
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

/** Base URL for building absolute links. */
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

/**
 * Parses a listing page from solventium.pt.
 *
 * Each item is a `.post_content.clearfix` block containing:
 * - Image, title, description, auction type, prices
 *
 * @param html - Raw HTML of the listing page
 * @param auctionType - Human-readable auction type label
 * @returns Array of basic Property objects
 */
export function parseSolventiumListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".lista_vendas .post_content.clearfix").each((_, item) => {
    const $item = $(item);

    // --- URL & external id ---
    // Link looks like ./?page=leilao&leilao=469&venda=372&tipo=2
    const detailHref = $item.find("#item_foto a").attr("href") || 
                       $item.find(".pesquisa_titulo a").attr("href") || "";
    const url = buildAbsoluteUrl(detailHref);

    const leilaoMatch = detailHref.match(/leilao=(\d+)/);
    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = leilaoMatch ? leilaoMatch[1] : "";
    if (!externalId) return;

    // --- Title (from texto_lote, first line) ---
    const textoLote = $item.find(".texto_lote").text().trim();
    const title = extractTitleFromTextoLote(textoLote);

    // --- Location (from texto_lote) ---
    const location = extractLocationFromTextoLote(textoLote);

    // --- Description (texto_lote without location) ---
    const description = extractDescriptionFromTextoLote(textoLote);

    // --- Image (thumbnail) ---
    const imgSrc = $item.find("#item_foto img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    // --- Auction type (from tipo_leilao_pesq) ---
    const auctionTypeFromPage = $item.find(".tipo_leilao_pesq").text().trim() || auctionType;

    // --- Prices ---
    // Valor Minimo de Venda → infobox_valorbase
    const minText = $item.find(".infobox_valores_pesq .infobox_valorbase p").first().text().trim();
    const minSaleValue = parsePrice(minText);
    
    // Current bid → infobox_valoractual
    const currentBidText = $item.find(".infobox_valores_pesq .infobox_valoractual p").text().trim();
    const currentBid = currentBidText.toLowerCase().includes("sem lances") ? 0 : parsePrice(currentBidText);
    
    // Use currentBid as the main price; fall back to minimum.
    const price = currentBid || minSaleValue || 0;

    // --- Status ---
    // Check if #leilao_terminado-{id} is visible (not display:none)
    const leilaoId = externalId;
    const $terminado = $item.find(`#leilao_terminado-${leilaoId}`);
    let status = "A decorrer";
    if ($terminado.length > 0 && $terminado.attr("style")?.includes("display:none") === false) {
      status = "VENDA TERMINADA";
    }

    // --- Process number (optional) ---
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

/**
 * Parses a detail (lote) page and enriches the base Property.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Enriched Property
 */
export function parseSolventiumDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // --- Gallery images: #imageGallery li img ---
  const images = extractGalleryImages($);

  // --- Description (detail page has cleaner text) ---
  const description =
    $(".detalhe_verba .post_content.pesquisa_titulo").text().trim() || base.description;

  // --- Location from description text ---
  const location = description ? extractLocationFromDescription(description) : undefined;
  const finalLocation = location || base.location;

  // --- Prices: detail page shows Valor de Venda / Valor Minimo / Valor Abertura / Valor Actual ---
  const priceInfo = extractDetailPrices($);

  // --- Use currentBid as the main price; fall back to openingValue ---
  const price = priceInfo.currentBid || priceInfo.openingValue || base.price;

  // --- District and municipality from location ---
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds an absolute URL from a possibly-relative href found in the page. */
function buildAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("./")) href = href.substring(2);
  return `${BASE_URL}/${href}`;
}

/**
 * Extracts title from texto_lote text.
 * Takes the first line or first meaningful sentence.
 */
function extractTitleFromTextoLote(text: string): string {
  if (!text) return "";
  // Remove HTML tags
  const cleanText = text.replace(/<[^>]*>/g, "").trim();
  // Split by newlines and take first non-empty line
  const lines = cleanText.split("\n").map(l => l.trim()).filter(l => l);
  if (lines.length > 0) {
    return lines[0].substring(0, 200); // Limit title length
  }
  return "Sem título";
}

/**
 * Extracts location from texto_lote text.
 * Looks for patterns like "Coruche", "Aradas - Aveiro", "Peniche"
 */
function extractLocationFromTextoLote(text: string): string | undefined {
  if (!text) return undefined;
  
  // Remove HTML tags
  const cleanText = text.replace(/<[^>]*>/g, " ");
  
  // Pattern: " - City" at the end of a line
  const dashMatch = cleanText.match(/-\s*([A-Z][A-Za-z\s]+)(?:\s*$|<br)/);
  if (dashMatch) {
    return dashMatch[1].trim();
  }
  
  // Pattern: "<b>City</b>" or just city name in caps
  const cityMatch = cleanText.match(/\b([A-Z][A-Z\s]+)\b/);
  if (cityMatch) {
    return cityMatch[1].trim();
  }
  
  return undefined;
}

/**
 * Extracts description from texto_lote, removing location and process info.
 */
function extractDescriptionFromTextoLote(text: string): string {
  if (!text) return "";
  
  // Remove HTML tags
  let cleanText = text.replace(/<[^>]*>/g, "\n");
  
  // Remove "Visitas:" lines
  cleanText = cleanText.replace(/Visitas:.*$/gm, "");
  
  // Remove "Processo:" lines
  cleanText = cleanText.replace(/Processo:.*$/gm, "");
  
  // Remove "Nota:" lines
  cleanText = cleanText.replace(/Nota:.*$/gm, "");
  
  // Remove "Endereço para propostas:" lines
  cleanText = cleanText.replace(/Endereço para propostas:.*$/gm, "");
  
  // Clean up whitespace
  cleanText = cleanText.replace(/\n\s*\n/g, "\n\n").trim();
  
  return cleanText;
}

/**
 * Extracts location from description text.
 * Looks for "Localização: ..." pattern.
 */
function extractLocationFromDescription(text: string): string | undefined {
  if (!text) return undefined;
  
  const match = text.match(/Localização:\s*([^<\n]+)/i);
  if (match) {
    return match[1].trim();
  }
  
  return undefined;
}

/**
 * Extracts all gallery image URLs from the detail page.
 */
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

/**
 * Extracts the price box values from the detail page.
 */
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

  // Try to get current bid from #valor-actual element
  const $valorActual = $("#valor-actual");
  if ($valorActual.length > 0) {
    const text = $valorActual.text().trim();
    // Skip "Sem licitações" text
    if (!text.toLowerCase().includes("sem licitações")) {
      result.currentBid = parsePrice(text);
    }
  }

  return result;
}

/**
 * Parses a location string into district and municipality.
 * Format: "CORUCHE" or "ARADAS - AVEIRO" or "PENICHE"
 */
function parseLocation(location: string): {
  district: string | undefined;
  municipality: string | undefined;
} {
  if (!location) {
    return { district: undefined, municipality: undefined };
  }

  // Split by " - " or "•"
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