/**
 * Leilosil Parser.
 *
 * Parses property auction data from www.leilosil.pt.
 *
 * Listing page: /pt/auction/category/id/5 (Imóveis)
 *   - Items in <ul class="auction-grid grid"> <li> elements
 *   - Each item has title, image, end date, link to detail
 *   - Prices are NOT in the listing HTML (loaded via JS)
 *
 * Detail page: /pt/leiloes/{slug}/{slug}
 *   - Title, description, images in HTML
 *   - Prices loaded via JavaScript/AJAX (need Puppeteer)
 */

import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice } from '../../utils/parser.js';

const BASE_URL = 'https://www.leilosil.pt';

/**
 * Parse the listing page for property auction items.
 *
 * Each <li> in .auction-grid contains:
 *  - .image a.img (link to detail + image)
 *  - Title text (e.g. "Armazém Industrial | Braga")
 *  - "Termina a DD/MM/YYYY HH:MM" (end date)
 *  - "N Lote" (lot count)
 */
export function parseLeilosilListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('.auction-grid li').each((_, element) => {
    const $el = $(element);

    // Extract detail link
    const $link = $el.find('a.img, a').first();
    const href = $link.attr('href') || '';

    if (!href || !href.includes('/leiloes/')) return;

    // Extract external ID from URL
    const slugParts = href.split('/').filter(Boolean);
    const externalId = slugParts[slugParts.length - 1] || slugParts[slugParts.length - 2] || '';

    // Extract title from text content
    const allText = $el.text();
    // Title is usually in format "Title | Location" before "Termina"
    const titleMatch = allText.match(/(.+?)(?:\s*(?:Termina|Ver Lotes|Lote))/s);
    let title = titleMatch ? titleMatch[1].trim() : '';
    // Clean up title - remove "N Lote" prefix
    title = title.replace(/^\d+\s*Lote\s*/i, '').trim();
    if (!title) return;

    // Extract location from title (after |)
    let location = '';
    if (title.includes('|')) {
      const parts = title.split('|');
      location = parts[parts.length - 1].trim();
    }

    // Extract end date
    const endDateMatch = allText.match(/Termina\s+a\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/);
    let endDate: Date | undefined;
    if (endDateMatch) {
      const [, day, month, year, hours, minutes] = endDateMatch[1].match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)!;
      endDate = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes)
      );
    }

    // Extract image
    const imgSrc = $el.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`);
    }

    // Extract lot count
    const lotMatch = allText.match(/(\d+)\s*Lote/i);
    const lotCount = lotMatch ? parseInt(lotMatch[1], 10) : 1;

    const property: Property = {
      source: 'leilosil',
      externalId,
      title,
      price: 0, // Will be enriched from detail page (JS-loaded)
      location,
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      images,
      auctionType: 'Leilão Eletrónico',
      status: 'active',
      publishedAt: endDate,
    };

    properties.push(property);
  });

  return properties;
}

/**
 * Parse a detail page for enriched data.
 * Note: Prices are loaded via JavaScript, so this parser handles
 * the static HTML content (title, description, images).
 * Prices must be extracted via Puppeteer.
 */
export function parseLeilosilDetail(html: string, base: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  // Extract title
  const title = $('h1, h2.title, .auction-title').first().text().trim();
  if (title) result.title = title;

  // Extract description
  const description = $('.description, .auction-description, .lot-description, #tab-description').text().trim();
  if (description) result.description = description;

  // Extract all images
  const images: string[] = [];
  $('img[src*="media/images"], img[src*="auctions"], img[src*="lots"]').each((_, img) => {
    const src = $(img).attr('src') || '';
    if (src && !src.includes('favicon') && !src.includes('logo')) {
      const fullSrc = src.startsWith('http') ? src : `${BASE_URL}${src}`;
      if (!images.includes(fullSrc)) {
        images.push(fullSrc);
      }
    }
  });
  if (images.length > 0) result.images = images;

  // Extract location from description or title
  if (!result.location && description) {
    const locMatch = description.match(/(?:Localização|Local)[:\s]*([^\n.;]+)/i);
    if (locMatch) result.location = locMatch[1].trim();
  }

  return result;
}

/**
 * Extract prices from a Puppeteer-rendered detail page.
 *
 * After JavaScript loads the auction data, prices appear in elements like:
 *  - .lot-value, .auction-value, .price
 *  - "Valor de Abertura", "Valor Mínimo", "Lance Atual"
 *
 * @param pageHtml - Full HTML from Puppeteer (after JS execution)
 * @returns Partial property with price data
 */
export function parseLeilosilPrices(pageHtml: string): Partial<Property> {
  const $ = cheerio.load(pageHtml);
  const result: Partial<Property> = {};

  // Try multiple selectors for prices
  const priceSelectors = [
    '.lot-value .amount',
    '.auction-value .amount',
    '.price .amount',
    '.current-bid .amount',
    '.opening-value .amount',
    '.minimum-value .amount',
    '.valor-abertura',
    '.valor-minimo',
    '.lance-atual',
  ];

  // Extract all price-like text
  const allText = $('body').text();

  // Look for "Valor de Abertura" pattern
  const openingMatch = allText.match(/(?:Valor\s+de\s+)?Abertura[^:]*:?\s*([\d.]+,\d{2})/i);
  if (openingMatch) {
    result.openingValue = parsePrice(openingMatch[1]);
    result.price = result.openingValue;
  }

  // Look for "Valor Mínimo" pattern
  const minMatch = allText.match(/M[ií]nimo[^:]*:?\s*([\d.]+,\d{2})/i);
  if (minMatch) {
    result.minSaleValue = parsePrice(minMatch[1]);
  }

  // Look for "Lance Atual" or current bid
  const currentMatch = allText.match(/(?:Lance|Atual|Current)[^:]*:?\s*([\d.]+,\d{2})/i);
  if (currentMatch) {
    result.currentBid = parsePrice(currentMatch[1]);
    if (result.currentBid > 0) result.price = result.currentBid;
  }

  // Fallback: try to find any price in .amount elements
  if (!result.price || result.price === 0) {
    const amounts = $('.amount').map((_, el) => $(el).text().trim()).get();
    for (const amt of amounts) {
      const parsed = parsePrice(amt);
      if (parsed > 0) {
        result.price = parsed;
        if (!result.openingValue) result.openingValue = parsed;
        break;
      }
    }
  }

  return result;
}
