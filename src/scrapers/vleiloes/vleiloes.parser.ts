import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

const BASE_URL = "https://www.vleiloes.com";

export const AUCTION_TYPE_LABELS: Record<number, string> = {
  1: "Leilão Presencial",
  2: "Leilão Electrónico",
  5: "Negociação",
  6: "Carta Fechada",
};

// prices are not in the listing; they only exist on the detail page
export function parseVLeiloesListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $(".lista_vendas article.post_format_standard").each((_, item) => {
    const $item = $(item);

    // link looks like ./?page=venda&venda=334
    const detailHref = $item.find(".title_area h1.post_title a").attr("href") || "";
    const url = buildAbsoluteUrl(detailHref);

    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = vendaMatch ? vendaMatch[1] : "";
    if (!externalId) return;

    const title = $item.find(".titulo_venda").text().trim();
    const location = $item.find(".cidade_venda").text().trim().replace(/\s+/g, " ");

    const descriptions: string[] = [];
    $item.find(".descricao_venda").each((_, desc) => {
      const text = $(desc).text().trim();
      if (text) descriptions.push(text);
    });
    const description = descriptions.join(" ");

    const imgSrc = $item.find(".pic_wrapper img").attr("src") || "";
    const image = imgSrc ? buildAbsoluteUrl(imgSrc) : undefined;

    const tipoLeilaoText = $item.find(".tipo_leilao").text().trim();
    // "Inicio:14/05/2026   10:00 | Fim:14/07/2026   12:00 |"
    const publishedAt = extractDateFromTipoLeilao(tipoLeilaoText, "Inicio");

    const status = $item.find(".a_decorrer").text().trim() || "A decorrer";

    properties.push({
      source: "vleiloes",
      externalId,
      title,
      description,
      price: 0,
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

export function parseVLeiloesDetail(html: string, base: Property): Property {
  const $ = cheerio.load(html);

  const description = $(".detalhe_verba .texto_lote").text().trim() || base.description;

  const location = description ? extractLocationFromDescription(description) : undefined;
  const finalLocation = location || base.location;

  const images = extractDetailImages($);

  const priceInfo = extractDetailPrices($);

  // current bid wins over opening value
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

function extractDateFromTipoLeilao(text: string, label: string): Date | undefined {
  if (!text) return undefined;
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

function extractLocationFromDescription(text: string): string | undefined {
  if (!text) return undefined;

  const match = text.match(/Localização:\s*([^<]+)/i);
  if (match) {
    return match[1].trim();
  }

  return undefined;
}

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

// table rows alternate: title (.venda_linha_titulo) then value (.venda_linha_valor)
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
        if (result.openingValue === undefined) {
          result.openingValue = value;
        }
      }
    }
  });

  // often loaded dynamically via JS, so it can be empty
  const $valorActual = $table.find("[id^='valor-actual-']").first();
  if ($valorActual.length > 0) {
    const text = $valorActual.text().trim();
    if (!text.toLowerCase().includes("sem licitações")) {
      result.currentBid = parsePrice(text);
    }
  }

  return result;
}

// format: "PORTALEGRE • AVIS • BENAVILA"
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
