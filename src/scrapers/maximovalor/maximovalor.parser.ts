import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice, extractCoordinates } from '../../utils/parser.js';

const BASE_URL = 'https://www.maximovalor.pt';

const ENGLISH_MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

// Parses "10 July 2026 às 16:00" (English month, Portuguese "às")
function parseEnglishDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  
  const match = dateStr.match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})\s*[às]+\s*(\d{2}):(\d{2})/);
  if (!match) return undefined;
  
  const [, day, monthStr, year, hours, minutes] = match;
  const month = ENGLISH_MONTHS[monthStr.toLowerCase()];
  
  if (month === undefined) return undefined;
  
  return new Date(
    parseInt(year),
    month,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    0
  );
}

// Parses "Albufeira, Faro" -> { municipality, district }
function parseLocation(locationStr: string): { district?: string; municipality?: string } {
  const parts = locationStr.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    return {
      municipality: parts[0],
      district: parts[1],
    };
  }
  return {};
}

export function parseMaximovalorListing(html: string, auctionType: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('.auctions .item').each((_, element) => {
    const $el = $(element);
    const $link = $el.closest('a');
    const href = $link.attr('href');
    
    if (!href) return;

    const title = $el.find('.title').text().trim();
    
    const urlParts = href.split('/').filter(Boolean);
    const externalId = urlParts[urlParts.length - 1] || href;
    
    const endDateText = $el.find('.detail:first-child span').text().trim();
    const endDate = parseEnglishDate(endDateText);
    
    const locationText = $el.find('.detail:last-child span').text().trim();
    const { district, municipality } = parseLocation(locationText);
    
    const thumbnail = $el.find('.thumbnail');
    const bgStyle = thumbnail.attr('style') || '';
    const imageMatch = bgStyle.match(/url\(['"]?([^'"]+)['"]?\)/);
    const image = imageMatch ? (imageMatch[1].startsWith('http') ? imageMatch[1] : `${BASE_URL}/${imageMatch[1]}`) : undefined;
    
    const property: Property = {
      source: 'maximovalor',
      externalId,
      title,
      description: undefined,
      price: 0, // Will be enriched from detail page
      location: locationText,
      district,
      municipality,
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      images: image ? [image] : [],
      auctionType,
      status: 'active',
      publishedAt: endDate,
    };

    properties.push(property);
  });

  return properties;
}

export function extractPagination(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html);
  
  // next page link is the one with a chevron-right icon
  const nextLink = $('.paginacao li a .fa-chevron-right').closest('a');
  const href = nextLink.attr('href');
  
  if (href) {
    return href.startsWith('http') ? href : `${BASE_URL}${href}`;
  }
  
  return undefined;
}

export function parseMaximovalorDetail(html: string, url: string): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const title = $('h1').text().trim();
  if (title) result.title = title;

  const locationFields = $('.location-table .field');
  if (locationFields.length >= 1) {
    const district = $(locationFields[0]).find('.value').text().trim();
    if (district) result.district = district;
  }
  if (locationFields.length >= 2) {
    const municipality = $(locationFields[1]).find('.value').text().trim();
    if (municipality) result.municipality = municipality;
  }
  if (locationFields.length >= 3) {
    const parish = $(locationFields[2]).find('.value').text().trim();
    if (parish) {
      // Store parish in description if needed
      result.description = (result.description || '') + `\nFreguesia: ${parish}`;
    }
  }

  const endDateText = $('.ending .date').text().trim();
  const endDate = parseEnglishDate(endDateText);
  if (endDate) result.publishedAt = endDate;

  const description = $('.bo-content').text().trim();
  if (description) {
    result.description = (result.description || '') + '\n\n' + description;
  }

  const auctionValues = $('.auction-values .item');
  let price = 0;
  let openingValue: number | undefined;
  let minSaleValue: number | undefined;

  auctionValues.each((_, el) => {
    const $el = $(el);
    const label = $el.clone().children().remove().end().text().trim();
    const valueText = $el.text().replace(label, '').trim();
    const value = parsePrice(valueText);

    if (label.includes('Valor de saída') || label.includes('Valor de Saída')) {
      price = value;
    } else if (label.includes('Valor mínimo') || label.includes('Valor Mínimo')) {
      minSaleValue = value;
    } else if (label.includes('Valor de abertura') || label.includes('Valor de Abertura')) {
      openingValue = value;
      if (price === 0) price = value; // Use opening value if no exit value
    }
  });

  result.price = price;
  if (openingValue) result.openingValue = openingValue;
  if (minSaleValue) result.minSaleValue = minSaleValue;

  const latestBidText = $('.latest').text().trim();
  const latestBidMatch = latestBidText.match(/([\d\s.,]+)\s*€/);
  if (latestBidMatch) {
    const latestBid = parsePrice(latestBidMatch[1]);
    if (latestBid > 0) {
      result.currentBid = latestBid;
      result.price = latestBid; // Use latest bid as main price
    }
  }

  const images: string[] = [];
  $('.gallery .item').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (href) {
      const imageUrl = href.startsWith('http') ? href : `${BASE_URL}/${href}`;
      images.push(imageUrl);
    }
  });
  if (images.length > 0) result.images = images;

  const documents: string[] = [];
  $('.listing-pdfs a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (href) {
      const docUrl = href.startsWith('http') ? href : `${BASE_URL}/${href}`;
      documents.push(docUrl);
    }
  });
  if (documents.length > 0) {
    result.description = (result.description || '') + '\n\nDocumentos: ' + documents.join(', ');
  }

  return result;
}