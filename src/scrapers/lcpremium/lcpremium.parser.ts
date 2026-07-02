/**
 * LC Premium Parser
 * 
 * Parses LC Premium HTML for both listing and detail pages.
 * Handles 4 auction types: electronic-auctions, live-auctions, sealed-bid, private-sales.
 * 
 * Key features:
 * - GPS coordinates from Google Maps query parameters (query=LAT,LON)
 * - Price extraction per auction type (Valor de Venda, Valor atual, Valor mínimo)
 * - Multiple lots handling (1 leilão → N lotes)
 * - Property details: area, rooms, bathrooms, garage
 * - Document links: Caderneta Predial, Descrição Predial, Visita Virtual
 */

import * as cheerio from 'cheerio';
import { Property } from '../../models/property';
import { propertyKey } from '../../models/property';

/** Type alias for a Cheerio element selection (a scoped DOM fragment) */
type CheerioEl = cheerio.Cheerio<any>;

/**
 * Parse LC Premium listing page HTML
 * 
 * @param html - Raw HTML from listing page
 * @param sectionType - Auction type (electronic-auctions, live-auctions, sealed-bid, private-sales)
 * @returns Object with properties array and next page URL
 */
export function parseLCPremiumListing(
  html: string,
  sectionType: string
): { properties: Property[]; nextUrl: string | null } {
  const $ = cheerio.load(html);
  const properties: Property[] = [];
  const nextUrl = extractNextPageUrl($, sectionType);

  // Each auction card has class .leilao-entry
  $('.leilao-entry').each((_, element) => {
    const $el = $(element);

    // Extract title and URL
    const title = $el.find('.entry-title a').first().text().trim();
    const url = $el.find('.entry-title a').first().attr('href');
    if (!url) return;

    // Extract externalId from URL pattern: /pt/{type}/{id}
    const externalIdMatch = url.match(/\/pt\/([^/]+)\/([^/]+)/);
    const externalId = externalIdMatch ? externalIdMatch[2] : '';

    // Extract location (first <li> in .entry-meta)
    const location = $el.find('.entry-meta li:first-child').text().trim();

    // Extract auction type and lot count from second <li>
    const auctionMeta = $el.find('.entry-meta li:nth-child(2)').text().trim();
    const lotCountMatch = auctionMeta.match(/(\d+)\s*Lote\(s\)/);
    const lotCount = lotCountMatch ? parseInt(lotCountMatch[1], 10) : 1;

    // Extract end date from third <li>
    const endDate = $el.find('.entry-meta li:nth-child(3)').text().trim();

    // Create base Property object
    const baseProperty: Property = {
      source: 'lcpremium',
      externalId,
      title,
      description: '', // Will be populated from detail page
      price: 0, // Will be populated from detail page
      location,
      url: url.startsWith('http') ? url : `https://www.lcpremium.pt${url}`,
      images: [],
      status: endDate.includes('Termina') ? 'active' : 'scheduled',
      publishedAt: new Date(), // Could parse endDate to get exact date
      // Auction-specific fields
      openingValue: undefined,
      minSaleValue: undefined,
      currentBid: undefined,
      // Location fields
      district: undefined,
      municipality: undefined,
      parish: undefined,
      latitude: undefined,
      longitude: undefined,
      // Property fields
      area: undefined,
      rooms: undefined,
    };

    // Only add if we have a valid externalId
    if (externalId) {
      properties.push(baseProperty);
    }
  });

  return { properties, nextUrl };
}

/**
 * Parse LC Premium detail page HTML
 * 
 * @param html - Raw HTML from detail page
 * @param base - Base Property object from listing page
 * @returns Array of Property objects (one per lot)
 */
export function parseLCPremiumDetail(
  html: string,
  base: Property
): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  // Find all lot blocks — electronic/live auctions use .bloco-lote,
  // private sales use .bloco-lote-verba
  const lotBlocks = $('.bloco-lote, .bloco-lote-verba');

  if (lotBlocks.length === 0) {
    // No lots found, return base as single property (search whole document)
    properties.push(enrichProperty(base, $, null));
    return properties;
  }

  // Process each lot — pass the scoped $lot element to enrichProperty()
  // instead of a lot index, so selectors use $lot.find() rather than
  // the broken :nth-child() pattern
  lotBlocks.each((_, element) => {
    const $lot = $(element);
    const enriched = enrichProperty(base, $, $lot);
    properties.push(enriched);
  });

  return properties;
}

/**
 * Enrich a Property object with data from detail page
 * 
 * Uses the scoped $lot Cheerio selection to find elements within the lot block,
 * avoiding the broken :nth-child() selector pattern used previously.
 * 
 * @param base - Base Property from listing page
 * @param $ - Cheerio instance of detail page
 * @param $lot - Scoped Cheerio selection for the lot block, or null to search whole document
 * @returns Enriched Property object
 */
function enrichProperty(
  base: Property,
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): Property {
  const enriched = { ...base };

  // Determine lot number from .title.lote for externalId and title
  const lotNumber = $lot !== null
    ? extractLotNumberFromBlock($, $lot)
    : null;

  if (lotNumber !== null) {
    enriched.externalId = `${base.externalId}_${lotNumber}`;
    enriched.title = `${base.title} - Lote ${lotNumber}`;
  }

  // Extract GPS coordinates from .lote-gps a
  const gpsElement = $lot !== null
    ? $lot.find('.lote-gps a').first()
    : $('.lote-gps a').first();

  if (gpsElement.length > 0) {
    const href = gpsElement.attr('href');
    if (href) {
      const coords = extractGPSFromUrl(href);
      if (coords) {
        enriched.latitude = coords.lat;
        enriched.longitude = coords.lon;
      }
    }
  }

  // Extract property details from .vertical-align spans (area in m²)
  const $spans = $lot !== null
    ? $lot.find('.vertical-align span')
    : $('.vertical-align span');

  $spans.each((_, element) => {
    const $span = $(element);
    const text = $span.text().trim();

    // Extract area (m²)
    const areaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*m²/);
    if (areaMatch) {
      enriched.area = parseFloat(areaMatch[1].replace(',', '.'));
    }
  });

  // Extract description from .lote-description
  const $desc = $lot !== null
    ? $lot.find('.lote-description')
    : $('.lote-description');
  if ($desc.length > 0) {
    enriched.description = $desc.text().trim();
  }

  // Extract address from .lote-adress
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

  // Extract price information based on auction type
  extractPrices(enriched, $, $lot);

  // Extract images from MagicThumb links
  const images = extractImages($, $lot);
  if (images.length > 0) {
    enriched.images = images;
  }

  // Extract document links
  const docs = extractDocuments($, $lot);
  // Could add docs as a separate field if needed

  return enriched;
}

/**
 * Extract lot number from the lot block's title element
 * 
 * @param $ - Cheerio instance
 * @param $lot - Scoped lot block selection
 * @returns Lot number, or null if not found
 */
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

/**
 * Extract GPS coordinates from Google Maps URL
 * 
 * @param url - URL with query parameter like ?api=1&query=41.4059500,-7.4497930
 * @returns Object with lat and lon, or null if not found
 */
function extractGPSFromUrl(url: string): { lat: number; lon: number } | null {
  const match = url.match(/query=(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
  if (!match) return null;

  return {
    lat: parseFloat(match[1]),
    lon: parseFloat(match[2])
  };
}

/**
 * Parse a Portuguese-formatted number string (e.g., "79.050,00" → 79050)
 * 
 * Portuguese format uses '.' as thousands separator and ',' as decimal separator.
 * 
 * @param raw - Number string with . as thousands separator and , as decimal
 * @returns Parsed number, or 0 if invalid
 */
function parsePortugueseNumber(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extract next page URL from pagination
 * 
 * @param $ - Cheerio instance
 * @param sectionType - Auction type
 * @returns Next page URL or null
 */
function extractNextPageUrl(
  $: cheerio.CheerioAPI,
  sectionType: string
): string | null {
  // Look for "Próximo" button or pagination link
  const $next = $('a:contains("Próximo")').first();
  if ($next.length > 0) {
    const href = $next.attr('href');
    if (href && href.startsWith('http')) {
      return href;
    }
  }

  // Alternative: Look for pagination links
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
 * Extract price information based on auction type
 * 
 * Handles three price display patterns:
 * 1. Electronic/live auctions: .bid-element blocks with "Valor de Venda" / "Valor atual" labels
 * 2. Private sales: .lote-valor-minimo span with "Valor Mínimo"
 * 3. Electronic auctions: .primeira-licitacao-valor-minimo span with minimum offer
 * 
 * @param prop - Property object to update
 * @param $ - Cheerio instance
 * @param $lot - Scoped lot block selection, or null for whole document
 */
function extractPrices(
  prop: Property,
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): void {
  // --- Private sales / sealed-bid: extract from .lote-valor-minimo ---
  const $minValue = $lot !== null
    ? $lot.find('.lote-valor-minimo')
    : $('.lote-valor-minimo');

  if ($minValue.length > 0) {
    const minText = $minValue.text();
    const minMatch = minText.match(/([\d.,]+)\s*€/);
    if (minMatch) {
      const value = parsePortugueseNumber(minMatch[1]);
      prop.price = value;
      prop.minSaleValue = value;
    }
  }

  // --- Electronic/live auctions: extract from .bid-element blocks ---
  const $bidElements = $lot !== null
    ? $lot.find('.bid-element')
    : $('.bid-element');

  $bidElements.each((_: number, element: any) => {
    const $el = $(element);
    const label = $el.find('.white-bg div:first-child').text().trim();
    const valueText = $el.find('.white-bg div:last-child').text().trim();
    const valueMatch = valueText.match(/([\d.,]+)\s*€/);

    if (!valueMatch) return;
    const value = parsePortugueseNumber(valueMatch[1]);

    if (label.includes('Valor de Venda')) {
      // "Valor de Venda" is the opening/sale value — maps to both price and openingValue
      prop.price = value;
      prop.openingValue = value;
    } else if (label.includes('Valor atual')) {
      prop.currentBid = value;
    } else if (label.toLowerCase().includes('valor mínimo')) {
      prop.minSaleValue = value;
    }
  });

  // --- Electronic auctions: extract minimum offer from .primeira-licitacao-valor-minimo ---
  const $minOffer = $lot !== null
    ? $lot.find('.primeira-licitacao-valor-minimo')
    : $('.primeira-licitacao-valor-minimo');

  if ($minOffer.length > 0) {
    const offerText = $minOffer.text();
    const offerMatch = offerText.match(/([\d.,]+)\s*€/);
    if (offerMatch) {
      prop.minSaleValue = parsePortugueseNumber(offerMatch[1]);
    }
  }
}

/**
 * Extract image URLs from MagicThumb links
 * 
 * @param $ - Cheerio instance
 * @param $lot - Scoped lot block selection, or null for whole document
 * @returns Array of image URLs
 */
function extractImages(
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): string[] {
  const images: string[] = [];

  // Find all MagicThumb links in the lot block
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

/**
 * Extract document links
 * 
 * @param $ - Cheerio instance
 * @param $lot - Scoped lot block selection, or null for whole document
 * @returns Array of document objects { type, url }
 */
function extractDocuments(
  $: cheerio.CheerioAPI,
  $lot: CheerioEl | null
): { type: string; url: string }[] {
  const docs: { type: string; url: string }[] = [];

  // Document buttons are in .lot-doc containers
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
