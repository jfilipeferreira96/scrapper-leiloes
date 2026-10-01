// listing HTML has no prices; they are JS-loaded and need Puppeteer
import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice } from '../../utils/parser.js';

const BASE_URL = 'https://www.leilosil.pt';

export function parseLeilosilListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('.auction-grid li').each((_, element) => {
    const $el = $(element);

    const $link = $el.find('a.img, a').first();
    const href = $link.attr('href') || '';

    if (!href || !href.includes('/leiloes/')) return;

    const slugParts = href.split('/').filter(Boolean);
    const externalId = slugParts[slugParts.length - 1] || slugParts[slugParts.length - 2] || '';

    const allText = $el.text();
    // title looks like "Armazém Industrial | Braga" and comes before "Termina"
    const titleMatch = allText.match(/(.+?)(?:\s*(?:Termina|Ver Lotes|Lote))/s);
    let title = titleMatch ? titleMatch[1].trim() : '';
    title = title.replace(/^\d+\s*Lote\s*/i, '').trim();
    if (!title) return;

    let location = '';
    if (title.includes('|')) {
      const parts = title.split('|');
      location = parts[parts.length - 1].trim();
    }

    // "Termina a DD/MM/YYYY HH:MM"
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

    const imgSrc = $el.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`);
    }

    const lotMatch = allText.match(/(\d+)\s*Lote/i);
    const lotCount = lotMatch ? parseInt(lotMatch[1], 10) : 1;

    const property: Property = {
      source: 'leilosil',
      externalId,
      title,
      price: 0,
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

// static content only; prices come from parseLeilosilPrices
export function parseLeilosilDetail(html: string, base: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const title = $('h1, h2.title, .auction-title').first().text().trim();
  if (title) result.title = title;

  const description = $('.description, .auction-description, .lot-description, #tab-description').text().trim();
  if (description) result.description = description;

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

  if (!result.location && description) {
    const locMatch = description.match(/(?:Localização|Local)[:\s]*([^\n.;]+)/i);
    if (locMatch) result.location = locMatch[1].trim();
  }

  return result;
}

// runs on the Puppeteer-rendered HTML after JS loads the auction data
export function parseLeilosilPrices(pageHtml: string): Partial<Property> {
  const $ = cheerio.load(pageHtml);
  const result: Partial<Property> = {};

  const allText = $('body').text();

  const openingMatch = allText.match(/(?:Valor\s+de\s+)?Abertura[^:]*:?\s*([\d.]+,\d{2})/i);
  if (openingMatch) {
    result.openingValue = parsePrice(openingMatch[1]);
    result.price = result.openingValue;
  }

  const minMatch = allText.match(/M[ií]nimo[^:]*:?\s*([\d.]+,\d{2})/i);
  if (minMatch) {
    result.minSaleValue = parsePrice(minMatch[1]);
  }

  const currentMatch = allText.match(/(?:Lance|Atual|Current)[^:]*:?\s*([\d.]+,\d{2})/i);
  if (currentMatch) {
    result.currentBid = parsePrice(currentMatch[1]);
    if (result.currentBid > 0) result.price = result.currentBid;
  }

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
