import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<AnyNode>;

const BASE_URL = "https://www.vamgo.pt";

const AUCTION_TYPES: Record<string, string> = {
  "1": "Leilão Presencial",
  "2": "Leilão Eletrônico",
  "6": "Carta Fechada",
  "7": "Negociação Particular",
};

export interface ListingItem {
  externalId: string;
  url: string;
  title: string;
  description: string;
  processInfo: string;
  image: string;
  auctionType: string;
  baseValue: number;
  minValue: number;
  currentBid: number;
}

export function parseVamgoListing(html: string): ListingItem[] {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];
  const seen = new Set<string>();

  $("div.post_content").each((_, el) => {
    const $item = $(el);

    const link = $item.find('a[href*="page=leilao"][href*="verba="]').first().attr("href") || "";
    if (!link) return;

    const query = link.slice(link.indexOf("?") + 1);
    const params = new URLSearchParams(query);
    const externalId = params.get("verba") || "";
    if (!externalId) return;
    if (seen.has(externalId)) return;
    seen.add(externalId);

    const title = cleanText($item.find(".span6 h1").first().text());
    const description = cleanText($item.find("p.texto_lote").first().text());
    const processInfo = cleanText($item.find(".pesq_processo h3").first().text());

    const imgSrc = $item.find(".span3 img").first().attr("src") || "";
    const image = imgSrc ? resolveUrl(imgSrc) : "";

    const tipo = params.get("tipo") || "";
    const auctionType = AUCTION_TYPES[tipo] || "Venda";

    const baseValue = extractTableValue($, $item, "Valor Base");
    const minValue = extractTableValue($, $item, "Valor Minimo");

    const leilaoId = params.get("leilao") || "";
    const bidEl = $item.find(`#valor-actual-${leilaoId}`).first().text();
    const currentBid = parsePrice(cleanText(bidEl));

    const url = resolveUrl(link);

    items.push({
      externalId,
      url,
      title: title || description.slice(0, 60),
      description,
      processInfo,
      image,
      auctionType,
      baseValue,
      minValue,
      currentBid: currentBid > 0 ? currentBid : 0,
    });
  });

  return items;
}

export function parseVamgoDetail(html: string, base: ListingItem): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const description = $(".texto_lote").first().text().trim();
  if (description) result.description = description;

  const images: string[] = [];
  const seen = new Set<string>();
  $("#detalhe img").each((_, img) => {
    const src = $(img).attr("src") || "";
    if (src && src.includes("/images/") && !seen.has(src)) {
      seen.add(src);
      images.push(resolveUrl(src));
    }
  });
  if (images.length > 0) result.images = images;

  const docs: string[] = [];
  $("a[href*='docs/']").each((_, a) => {
    const href = $(a).attr("href") || "";
    const name = cleanText($(a).text());
    if (href && name) {
      docs.push(`${name}: ${resolveUrl(href)}`);
    }
  });
  if (docs.length > 0) {
    result.description = `${result.description || base.description}\n\nDocumentos:\n${docs.join("\n")}`;
  }

  const locationText = extractLocation(base.description);
  if (locationText) {
    result.location = locationText;
  }

  const districtMatch = base.description.match(/concelho d[aeo]?\s+((?:[A-ZÀ-Ú][\wÀ-ú']*)(?:\s+(?:d[aeo]\s+)?[A-ZÀ-Ú][\wÀ-ú']*)*)/);
  if (districtMatch) {
    result.district = districtMatch[1].trim();
  }

  const processMatch = base.processInfo.match(/Processo n[.ºo°]+\s*(?:no\s+)?([\w/.\-]+)/i);
  if (processMatch && !result.description?.includes("Processo")) {
    result.description = `${result.description || ""}\n\nProcesso: ${processMatch[1]}`.trim();
  }

  return result;
}

function extractTableValue($: cheerio.CheerioAPI, $item: CheerioEl, label: string): number {
  let value = 0;
  $item.find(".venda_valores table tr").each((_, tr) => {
    const labelText = cleanText($(tr).find("td").first().text());
    if (labelText.includes(label)) {
      const valText = cleanText($(tr).find("td").last().text());
      value = parsePrice(valText);
    }
  });
  return value;
}

// descriptions open with the location: "sito em X, concelho de Y" / "situado na X, Y"
function extractLocation(description: string): string | undefined {
  if (!description) return undefined;

  const m1 = description.match(/(?:sito|sita|situado|situada|localizado|localizada)\s+(?:em|na|no)\s+([^.,;]{4,60})/i);
  if (m1) return m1[1].trim();

  return undefined;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url.replace("/./", "/");
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${BASE_URL}${url.replace("/./", "/")}`;
  return `${BASE_URL}/${url}`;
}
