/**
 * Leilosoc Parser.
 *
 * Hard-coded filter: only Portugal properties are kept.
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

export function parseLeilosocListing(
  html: string
): { properties: Property[]; totalPages: number } {
  const $ = cheerio.load(html);
  const properties: Property[] = [];
  const totalPages = extractTotalPages($);

  const $cards = $('.col-6.col-lg-4.col-xl-3');
  
  // Fallback: try alternative selectors if main selector fails
  let $cardsToUse = $cards;
  if ($cards.length === 0) {
    const $lotLinks = $('a[href*="/lot/"]');
    if ($lotLinks.length > 0) {
      $cardsToUse = $lotLinks.parent();
    }
  }
  
  $cardsToUse.each((_, element) => {
    const $el = $(element);

    const $link = $el.find('a[href*="/lot/"]').first();
    if ($link.length === 0) return;
    
    const title = $link.find('h3').first().text().trim() || $link.attr('aria-label') || '';
    const url = $link.attr('href');
    
    if (!url || !title) return;

    // Hard-coded filter: only Portugal (img alt or span text in .auction-card-location)
    const $locationDiv = $link.find('.auction-card-location').first();
    const countryImg = $locationDiv.find('img').attr('alt');
    const countryText = $locationDiv.find('span').text().trim();
    
    const isPortugal = countryImg === 'Portugal' || countryText === 'Portugal';
    if (!isPortugal) return;

    // Extract externalId from URL pattern: /lot/{auction_id}/{lot_id}-{slug}
    const externalIdMatch = url.match(/\/lot\/(\d+)\/(\d+)-/);
    const externalId = externalIdMatch ? `${externalIdMatch[1]}-${externalIdMatch[2]}` : '';

    // Extract location (process number) from auction-card-location
    const location = $locationDiv.find('p').first().text().trim() || '';

    // Extract price from "Licitação atual"
    const priceText = $link.find('.card-footer .c-fqASOw-bYugTg-size-h6').first().text().trim() ||
                      $link.find('[class*="size-h6"]').first().text().trim() || '';
    const price = priceText ? parsePrice(priceText) : 0;

    const endDateText = $link.find('.auction-card-end-date span').last().text().trim();
    const endDate = endDateText || '';

    const auctionType = $link.find('.c-eZxjCV').first().text().trim() || '';

    const imageUrl = $link.find('img').first().attr('src');

    const baseProperty: Property = {
      source: 'leilosoc',
      externalId,
      title,
      description: '',
      price,
      location,
      url: url.startsWith('http') ? url : `https://leilosoc.com${url}`,
      images: imageUrl ? [imageUrl] : [],
      status: endDate ? 'active' : 'scheduled',
      publishedAt: new Date(),
      openingValue: undefined,
      minSaleValue: undefined,
      currentBid: price > 0 ? price : undefined,
      district: undefined,
      municipality: undefined,
      parish: undefined,
      latitude: undefined,
      longitude: undefined,
      area: undefined,
      rooms: undefined,
    };

    if (externalId && url) {
      properties.push(baseProperty);
    }
  });

  return { properties, totalPages };
}

/** Pagination shows text like "de 4 páginas". */
function extractTotalPages($: cheerio.CheerioAPI): number {
  const pageText = $('.c-jlSElw').text();
  const match = pageText.match(/de\s+(\d+)\s+páginas/i);
  if (match) {
    return parseInt(match[1], 10);
  }

  const $pageSelect = $('select').filter(function() {
    return $(this).find('option').first().attr('value') === '1';
  });
  if ($pageSelect.length > 0) {
    return $pageSelect.find('option').length;
  }

  return 1;
}

export function parseLeilosocDetail(
  html: string,
  base: Property
): Property {
  const $ = cheerio.load(html);
  const enriched = { ...base };

  const $title = $('h1').first();
  if ($title.length > 0) {
    enriched.title = $title.text().trim();
  }

  const reference = extractDetailValue($, 'Referência');
  if (reference) {
    enriched.externalId = reference;
  }

  extractLocationDetails($, enriched);

  const endDateText = extractInfoValue($, 'Data de término');
  if (endDateText) {
    enriched.publishedAt = parseEndDate(endDateText);
  }

  extractPriceDetails($, enriched);

  const images = extractImages($);
  if (images.length > 0) {
    enriched.images = images;
  }

  const description = extractDescription($);
  if (description) {
    enriched.description = description;
  }

  extractPropertyFeatures($, enriched);

  return enriched;
}

function extractDetailValue($: cheerio.CheerioAPI, label: string): string | null {
  const $rows = $('.row, .detail-row, [class*="detail"]');
  
  for (const element of $rows) {
    const $row = $(element);
    const $label = $row.find('p, span, div').first();
    const labelText = $label.text().trim();
    
    if (labelText.includes(label)) {
      const $value = $label.next('p, span, div').first();
      if ($value.length > 0) {
        return $value.text().trim();
      }
    }
  }

  return null;
}

function extractInfoValue($: cheerio.CheerioAPI, label: string): string | null {
  const $info = $('[style*="grid-area:info"], .info-section');
  if ($info.length > 0) {
    const text = $info.text();
    const match = text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`));
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function extractLocationDetails($: cheerio.CheerioAPI, prop: Property): void {
  const $locationSection = $('h3:contains("Localização")').parent();
  
  if ($locationSection.length > 0) {
    const $city = $locationSection.find('p[style*="font-weight:700"]').first();
    if ($city.length > 0) {
      prop.municipality = $city.text().trim();
      prop.location = $city.text().trim();
    }

    const $address = $locationSection.find('p').not('[style*="font-weight:700"]').first();
    if ($address.length > 0) {
      const addressText = $address.text().trim();
      prop.location = addressText;
      
      const parts = addressText.split(',');
      if (parts.length >= 2) {
        prop.district = parts[parts.length - 1].trim().replace('Portugal', '').trim();
        if (parts.length >= 3) {
          prop.municipality = parts[parts.length - 2].trim();
        }
      }
    }
  }
}

/** Format: "03/07/2026 18:00" */
function parseEndDate(dateText: string): Date {
  const match = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hours, minutes] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours), parseInt(minutes));
  }
  
  return new Date();
}

function extractPriceDetails($: cheerio.CheerioAPI, prop: Property): void {
  const $priceSection = $('[style*="grid-area:info"], .price-section');
  
  if ($priceSection.length > 0) {
    const currentBidText = extractPriceLabel($, 'Licitação atual');
    if (currentBidText) {
      const match = currentBidText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.currentBid = parsePrice(match[1]);
        prop.price = parsePrice(match[1]);
      }
    }

    const openingValueText = extractPriceLabel($, 'Valor de Abertura');
    if (openingValueText) {
      const match = openingValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.openingValue = parsePrice(match[1]);
      }
    }

    const baseValueText = extractPriceLabel($, 'Valor base');
    if (baseValueText) {
      const match = baseValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.price = parsePrice(match[1]);
      }
    }

    const minValueText = extractPriceLabel($, 'Valor Mínimo');
    if (minValueText && minValueText !== '---') {
      const match = minValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.minSaleValue = parsePrice(match[1]);
      }
    }
  }
}

function extractPriceLabel($: cheerio.CheerioAPI, label: string): string | null {
  const $label = $(`span:contains("${label}")`);
  if ($label.length > 0) {
    const $value = $label.parent().find('p, span').not($label).first();
    if ($value.length > 0) {
      return $value.text().trim();
    }
  }
  return null;
}

function extractImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  
  const $images = $('.slick-slide img, .thumbnail img');
  $images.each((_, element) => {
    const $img = $(element);
    const src = $img.attr('src') || $img.attr('data-src');
    if (src && src.startsWith('http') && !images.includes(src)) {
      images.push(src);
    }
  });

  return images;
}

function extractDescription($: cheerio.CheerioAPI): string {
  const $descSection = $('h3:contains("Descrição"), div:contains("Descrição")').parent();
  if ($descSection.length > 0) {
    const $desc = $descSection.find('.c-bAJmbT, .description, .rich-text').first();
    if ($desc.length > 0) {
      return $desc.text().trim();
    }
  }
  return '';
}

function extractPropertyFeatures($: cheerio.CheerioAPI, prop: Property): void {
  const $detailsSection = $('h3:contains("Detalhes")').parent();
  if ($detailsSection.length > 0) {
    const desc = prop.description;
    if (desc) {
      const areaMatch = desc.match(/(\d+(?:[.,]\d+)?)\s*m²/);
      if (areaMatch) {
        prop.area = parseFloat(areaMatch[1].replace(',', '.'));
      }
    }
  }
}
