/**
 * LC Premium Parser.
 *
 * Handles 4 auction types: electronic-auctions, live-auctions, sealed-bid,
 * private-sales. One auction can contain multiple lots; GPS coordinates come
 * from Google Maps links (query=LAT,LON).
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { propertyKey } from "../../models/property.js";
import { parsePrice, extractCoordinates } from "../../utils/parser.js";

type CheerioEl = cheerio.Cheerio<any>;

export function parseLCPremiumListing(
  html: string,
  sectionType: string
): { properties: Property[]; nextUrl: string | null } {
  const $ = cheerio.load(html);
  const properties: Property[] = [];
  const nextUrl = extractNextPageUrl($, sectionType);

  $('.leilao-entry').each((_, element) => {
    const $el = $(element);

    const title = $el.find('.entry-title a').first().text().trim();
    const url = $el.find('.entry-title a').first().attr('href');
    if (!url) return;

    // Extract externalId from URL pattern: /pt/{type}/{id}
    const externalIdMatch = url.match(/\/pt\/([^/]+)\/([^/]+)/);
    const externalId = externalIdMatch ? externalIdMatch[2] : '';

    const location = $el.find('.entry-meta li:first-child').text().trim();

    const auctionMeta = $el.find('.entry-meta li:nth-child(2)').text().trim();
    const lotCountMatch = auctionMeta.match(/(\d+)\s*Lote\(s\)/);
    const lotCount = lotCountMatch ? parseInt(lotCountMatch[1], 10) : 1;

    const endDate = $el.find('.entry-meta li:nth-child(3)').text().trim();

    const baseProperty: Property = {
      source: 'lcpremium',
      externalId,
      title,
      description: '',
      price: 0,
      location,
      url: url.startsWith('http') ? url : `https://www.lcpremium.pt${url}`,
      images: [],
      status: endDate.includes('Termina') ? 'active' : 'scheduled',
      publishedAt: new Date(),
      openingValue: undefined,
      minSaleValue: undefined,
      currentBid: undefined,
      district: undefined,
      municipality: undefined,
      parish: undefined,
      latitude: undefined,
      longitude: undefined,
      area: undefined,
      rooms: undefined,
    };

    if (externalId) {
      properties.push(baseProperty);
    }
  });

  return { properties, nextUrl };
}

export function parseLCPremiumDetail(
  html: string,
  base: Property
): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  // .bloco-lote for electronic/live, .bloco-lote-verba for private sales
  const lotBlocks = $('.bloco-lote, .bloco-lote-verba');

  if (lotBlocks.length === 0) {
    properties.push(enrichProperty(base, $, null));
    return properties;
  }

  lotBlocks.each((_, element) => {
    const $lot = $(element);
    const enriched = enrichProperty(base, $, $lot);
    properties.push(enriched);
  });

  return properties;
}

function enrichProperty(
  base: Property,
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): Property {
  const enriched = { ...base };

  const lotNumber = $lot !== null
    ? extractLotNumberFromBlock($, $lot)
    : null;

  if (lotNumber !== null) {
    enriched.externalId = `${base.externalId}_${lotNumber}`;
    enriched.title = `${base.title} - Lote ${lotNumber}`;
  }

  const gpsElement = $lot !== null
    ? $lot.find('.lote-gps a').first()
    : $('.lote-gps a').first();

  if (gpsElement.length > 0) {
    const href = gpsElement.attr('href');
    if (href) {
      const coords = extractCoordinates(href);
      if (coords) {
        enriched.latitude = coords.lat;
        enriched.longitude = coords.lon;
      }
    }
  }

  const $spans = $lot !== null
    ? $lot.find('.vertical-align span')
    : $('.vertical-align span');

  $spans.each((_, element) => {
    const $span = $(element);
    const text = $span.text().trim();

    const areaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*m²/);
    if (areaMatch) {
      enriched.area = parseFloat(areaMatch[1].replace(',', '.'));
    }
  });

  const $desc = $lot !== null
    ? $lot.find('.lote-description')
    : $('.lote-description');
  if ($desc.length > 0) {
    enriched.description = $desc.text().trim();
  }

  const $addr = $lot !== null
    ? $lot.find('.lote-adress')
    : $('.lote-adress');
  if ($addr.length > 0) {
    const addrText = $addr.text().trim();
    const parts = addrText.split(' - ');
    if (parts.length >= 2) {
      enriched.municipality = parts[parts.length - 1].trim();
      enriched.location = addrText;
    }
  }

  extractPrices(enriched, $, $lot);

  const images = extractImages($, $lot);
  if (images.length > 0) {
    enriched.images = images;
  }

  const docs = extractDocuments($, $lot);

  return enriched;
}

function extractLotNumberFromBlock(
  $: cheerio.CheerioAPI,
  $lot: CheerioEl
): number | null {
  const $title = $lot.find('.title.lote').first();
  if ($title.length === 0) return null;
  const text = $title.text().trim();
  const match = text.match(/(?:Lote|Verba)\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}



function extractNextPageUrl(
  $: cheerio.CheerioAPI,
  sectionType: string
): string | null {
  const $next = $('a:contains("Próximo")').first();
  if ($next.length > 0) {
    const href = $next.attr('href');
    if (href && href.startsWith('http')) {
      return href;
    }
  }

  const $pagination = $('.pagination a').first();
  if ($pagination.length > 0) {
    const href = $pagination.attr('href');
    if (href && href.includes('page=')) {
      return href;
    }
  }

  return null;
}

/**
 * Price patterns: "Valor de Venda"/"Valor atual" in .bid-element blocks
 * (electronic/live), "Valor Mínimo" in .lote-valor-minimo (private sales),
 * minimum offer in .primeira-licitacao-valor-minimo (electronic).
 */
function extractPrices(
  prop: Property,
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): void {
  const $minValue = $lot !== null
    ? $lot.find('.lote-valor-minimo')
    : $('.lote-valor-minimo');

  if ($minValue.length > 0) {
    const minText = $minValue.text();
    const minMatch = minText.match(/([\d.,]+)\s*€/);
    if (minMatch) {
      const value = parsePrice(minMatch[1]);
      prop.price = value;
      prop.minSaleValue = value;
    }
  }

  const $bidElements = $lot !== null
    ? $lot.find('.bid-element')
    : $('.bid-element');

  $bidElements.each((_: number, element: any) => {
    const $el = $(element);
    const label = $el.find('.white-bg div:first-child').text().trim();
    const valueText = $el.find('.white-bg div:last-child').text().trim();
    const valueMatch = valueText.match(/([\d.,]+)\s*€/);

    if (!valueMatch) return;
    const value = parsePrice(valueMatch[1]);

    if (label.includes('Valor de Venda')) {
      // "Valor de Venda" is the opening/sale value: maps to price and openingValue
      prop.price = value;
      prop.openingValue = value;
    } else if (label.includes('Valor atual')) {
      prop.currentBid = value;
    } else if (label.toLowerCase().includes('valor mínimo')) {
      prop.minSaleValue = value;
    }
  });

  const $minOffer = $lot !== null
    ? $lot.find('.primeira-licitacao-valor-minimo')
    : $('.primeira-licitacao-valor-minimo');

  if ($minOffer.length > 0) {
    const offerText = $minOffer.text();
    const offerMatch = offerText.match(/([\d.,]+)\s*€/);
    if (offerMatch) {
      prop.minSaleValue = parsePrice(offerMatch[1]);
    }
  }
}

function extractImages(
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): string[] {
  const images: string[] = [];

  const $magicThumb = $lot !== null
    ? $lot.find('.MagicThumb')
    : $('.MagicThumb');

  $magicThumb.each((_: number, element: any) => {
    const href = $(element).attr('href');
    if (href && href.startsWith('http')) {
      images.push(href);
    }
  });

  return images;
}

function extractDocuments(
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): { type: string; url: string }[] {
  const docs: { type: string; url: string }[] = [];

  const $docContainers = $lot !== null
    ? $lot.find('.lot-doc')
    : $('.lot-doc');

  $docContainers.each((_: number, element: any) => {
    const $container = $(element);
    const $link = $container.find('.link').first();
    const href = $link.attr('href');
    const label = $container.find('.bt-label').text().trim();

    if (href && href.startsWith('http')) {
      docs.push({ type: label, url: href });
    }
  });

  return docs;
}
