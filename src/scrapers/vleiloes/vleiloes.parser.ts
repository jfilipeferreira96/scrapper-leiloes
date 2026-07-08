/**
 * VLeiloes Parser.
 *
 * Parses listing and detail pages from www.vleiloes.com.
 *
 * Auction types (param ?tipo=N):
 *   1 → Leilão Presencial
 *   2 → Leilão Electrónico
 *   5 → Negociação
 *   6 → Carta Fechada
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

/** Base URL for building absolute links. */
const BASE_URL = "https://www.vleiloes.com";

/** Maps the ?tipo= query param to a human-readable auction type. */
export const AUCTION_TYPE_LABELS: Record<number, string> = {
  1: "Leilão Presencial",
  2: "Leilão Electrónico",
  5: "Negociação",
  6: "Carta Fechada",
};

/**
 * Parses a listing page from vleiloes.com.
 *
 * Each item is an <article> element inside .lista_vendas containing:
 * - Image, title, location, description, auction type, dates
 * - Prices are NOT in the listing; they are only on the detail page
 *
 * @param html - Raw HTML of the listing page
 * @param auctionType - Human-readable auction type label
 * @returns Array of basic Property objects
 */
export function parseVLeiloesListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".lista_vendas article.post_format_standard").each((_, item) => {
    const $item = $(item);

    // --- URL & external id ---
    // Link looks like ./?page=venda&venda=334
    const detailHref = $item.find(".title_area h1.post_title a").attr("href") || "";
    const url = buildAbsoluteUrl(detailHref);

    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = vendaMatch ? vendaMatch[1] : "";
    if (!externalId) return;

    // --- Title ---
    const title = $item.find(".titulo_venda").text().trim();

    // --- Location ---
    const location = $item.find(".cidade_venda").text().trim().replace(/\s+/g, " ");

    // --- Description (can be multiple .descricao_venda spans) ---
    const descriptions: string[] = [];
    $item.find(".descricao_venda").each((_, desc) => {
      const text = $(desc).text().trim();
      if (text) descriptions.push(text);
    });
    const description = descriptions.join(" ");

    // --- Image (thumbnail) ---
    const imgSrc = $item.find(".pic_wrapper img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    // --- Auction type, dates, and status from .tipo_leilao ---
    const tipoLeilaoText = $item.find(".tipo_leilao").text().trim();
    // Extract start/end dates from "Inicio:14/05/2026   10:00 | Fim:14/07/2026   12:00 |"
    const publishedAt = extractDateFromTipoLeilao(tipoLeilaoText, "Inicio");
    const endDate = extractDateFromTipoLeilao(tipoLeilaoText, "Fim");

    // Status from .a_decorrer span
    const status = $item.find(".a_decorrer").text().trim() || "A decorrer";

    // --- Prices are NOT in the listing; only on detail page ---
    // We'll set price = 0 for now and enrich in detail page
    const price = 0;

    properties.push({
      source: "vleiloes",
      externalId,
      title,
      description,
      price,
      location: location || "Localização não especificada",
      auctionType,
      url,
      images: image ? [image] : [],
      status,
      publishedAt,
    });
  });

  return properties;
}

/**
 * Parses a detail (venda) page and enriches the base Property.
 *
 * @param html - Raw HTML of the detail page
 * @param base - Base Property from the listing
 * @returns Enriched Property
 */
export function parseVLeiloesDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  // --- Description (detail page has cleaner text) ---
  const description = $(".detalhe_verba .texto_lote").text().trim() || base.description;

  // --- Location from description text ---
  const location = description ? extractLocationFromDescription(description) : undefined;
  const finalLocation = location || base.location;

  // --- Images ---
  const images = extractDetailImages($);

  // --- Prices from venda_tabela ---
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
 * Extracts a date from .tipo_leilao text like "Inicio:14/05/2026   10:00 | Fim:14/07/2026   12:00 |"
 */
function extractDateFromTipoLeilao(text: string, label: string): Date | undefined {
  if (!text) return undefined;
  // Normalize label (accent handling)
  const normalizedLabel = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  const regex = new RegExp(`${normalizedLabel}:\\s*(\\d{2})/(\\d{2})/(\\d{4})\\s+(\\d{2}):(\\d{2})`);
  const match = normalizedText.match(regex);
  
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

/**
 * Extracts location from description text.
 * Looks for "Localização: ..." pattern.
 */
function extractLocationFromDescription(text: string): string | undefined {
  if (!text) return undefined;
  
  const match = text.match(/Localização:\s*([^<]+)/i);
  if (match) {
    return match[1].trim();
  }
  
  return undefined;
}

/**
 * Extracts all image URLs from the detail page.
 */
function extractDetailImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  $(".detalhe_verba .span3 a img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      images.push(src.startsWith("http") ? src : buildAbsoluteUrl(src));
    }
  });
  return [...new Set(images)];
}

/**
 * Extracts price information from the venda_tabela table.
 * The table has alternating rows: title row (.venda_linha_titulo) followed by value row (.venda_linha_valor)
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

  const $table = $(".venda_tabela").first();
  if ($table.length === 0) return result;

  const $rows = $table.find("tr");
  let currentLabel = "";

  $rows.each((_, row) => {
    const $row = $(row);
    const $titulo = $row.find(".venda_linha_titulo");
    const $valor = $row.find(".venda_linha_valor");

    if ($titulo.length > 0) {
      currentLabel = $titulo.text().trim().toLowerCase();
    } else if ($valor.length > 0) {
      const value = parsePrice($valor.text());

      if (currentLabel.includes("abertura")) {
        result.openingValue = value;
      } else if (currentLabel.includes("minimo") || currentLabel.includes("mínimo")) {
        result.minSaleValue = value;
      } else if (currentLabel.includes("base")) {
        // Valor Base is often the opening value
        if (result.openingValue === undefined) {
          result.openingValue = value;
        }
      }
    }
  });

  // Try to get current bid from #valor-actual-{id} element
  // Note: This is often loaded dynamically via JS, so it might be empty
  const $valorActual = $table.find("[id^='valor-actual-']").first();
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
 * Format: "PORTALEGRE • AVIS • BENAVILA" or "PORTALEGRE • AVIS"
 */
function parseLocation(location: string): {
  district: string | undefined;
  municipality: string | undefined;
} {
  const parts = location.split("•").map(p => p.trim());
  
  if (parts.length >= 1) {
    return {
      district: parts[0] || undefined,
      municipality: parts[1] || undefined,
    };
  }
  
  return {
    district: undefined,
    municipality: undefined,
  };
}