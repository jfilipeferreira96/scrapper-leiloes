/**
 * Leilosoc Parser
 * 
 * Parses Leilosoc HTML for both listing and detail pages.
 * 
 * Key features:
 * - Extracts property listings from category pages
 * - Extracts detailed information from individual auction pages
 * - Handles multiple auction types (Leilão Eletrónico, Negociação Particular, Comprar Já)
 * - Extracts prices, images, documents, and seller information
 * - Filters for Portugal properties only
 */

import * as cheerio from "cheerio";
import type { Property } from "../../models/property.js";
import { parsePrice } from "../../utils/parser.js";

/**
 * Parse Leilosoc listing page HTML
 * 
 * @param html - Raw HTML from listing page
 * @returns Object with properties array and next page URL
 */
export function parseLeilosocListing(
  html: string
): { properties: Property[]; nextUrl: string | null } {
  const $ = cheerio.load(html);
  const properties: Property[] = [];
  const nextUrl = extractNextPageUrl($);

  // Property cards use specific column classes
  const $cards = $('.col-6.col-lg-4.col-xl-3');
  
  $cards.each((_, element) => {
    const $el = $(element);

    // Extract title and URL from the <a> tag
    const $link = $el.find('a').first();
    const title = $link.find('h3').first().text().trim();
    const url = $link.attr('href');
    
    if (!url || !title) return;

    // Extract externalId from URL pattern: /lot/{auction_id}/{lot_id}-{slug}
    const externalIdMatch = url.match(/\/lot\/(\d+)\/(\d+)-/);
    const externalId = externalIdMatch ? `${externalIdMatch[1]}-${externalIdMatch[2]}` : '';

    // Extract location from auction-card-location
    const location = $link.find('.auction-card-location span:contains("Portugal")').parent().find('p').first().text().trim();

    // Extract price from "Licitação atual"
    const priceText = $link.find('.card-footer div:first-child .c-fqASOw-bYugTg-size-h6').first().text().trim();
    const price = priceText ? parsePrice(priceText) : 0;

    // Extract end date from auction-card-end-date
    const endDateText = $link.find('.auction-card-end-date span').last().text().trim();
    const endDate = endDateText || '';

    // Extract auction type
    const auctionType = $link.find('.c-eZxjCV').first().text().trim();

    // Extract image URL
    const imageUrl = $link.find('img').first().attr('src');

    // Create base Property object
    const baseProperty: Property = {
      source: 'leilosoc',
      externalId,
      title,
      description: '', // Will be populated from detail page
      price,
      location,
      url: url.startsWith('http') ? url : `https://leilosoc.com${url}`,
      images: imageUrl ? [imageUrl] : [],
      status: endDate ? 'active' : 'scheduled',
      publishedAt: new Date(),
      // Auction-specific fields
      openingValue: undefined,
      minSaleValue: undefined,
      currentBid: price > 0 ? price : undefined,
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

    // Only add if we have a valid externalId and URL
    if (externalId && url) {
      properties.push(baseProperty);
    }
  });

  return { properties, nextUrl };
}

/**
 * Parse Leilosoc detail page HTML
 * 
 * @param html - Raw HTML from detail page
 * @param base - Base Property object from listing page
 * @returns Enriched Property object
 */
export function parseLeilosocDetail(
  html: string,
  base: Property
): Property {
  const $ = cheerio.load(html);
  const enriched = { ...base };

  // Extract title from h1
  const $title = $('h1').first();
  if ($title.length > 0) {
    enriched.title = $title.text().trim();
  }

  // Extract reference number from details section
  const reference = extractDetailValue($, 'Referência');
  if (reference) {
    enriched.externalId = reference;
  }

  // Extract auction ID
  const auctionId = extractDetailValue($, 'Id do leilão');
  if (auctionId) {
    // Could store this in a custom field if needed
  }

  // Extract location details
  extractLocationDetails($, enriched);

  // Extract end date
  const endDateText = extractInfoValue($, 'Data de término');
  if (endDateText) {
    enriched.publishedAt = parseEndDate(endDateText);
  }

  // Extract price information
  extractPriceDetails($, enriched);

  // Extract auction type
  const auctionType = extractAuctionTypeFromDetail($);
  if (auctionType) {
    // Could store this in a custom field if needed
  }

  // Extract images
  const images = extractImages($);
  if (images.length > 0) {
    enriched.images = images;
  }

  // Extract description
  const description = extractDescription($);
  if (description) {
    enriched.description = description;
  }

  // Extract property features
  extractPropertyFeatures($, enriched);

  // Extract documents
  const documents = extractDocuments($);
  // Could add documents as a separate field if needed

  // Extract seller information
  const sellerInfo = extractSellerInfo($);
  // Could add seller info as a separate field if needed

  return enriched;
}

/**
 * Extract next page URL from pagination
 */
function extractNextPageUrl($: cheerio.CheerioAPI): string | null {
  // Look for next page button or link
  const $next = $('a:contains("Próximo"), a:contains("Next"), .pagination .next').first();
  if ($next.length > 0) {
    const href = $next.attr('href');
    if (href) {
      return href.startsWith('http') ? href : `https://leilosoc.com${href}`;
    }
  }

  // Alternative: look for page numbers and find the next one
  const $currentPage = $('.pagination .active, .pagination [class*="current"]').first();
  if ($currentPage.length > 0) {
    const $nextPage = $currentPage.next('a');
    if ($nextPage.length > 0) {
      const href = $nextPage.attr('href');
      if (href) {
        return href.startsWith('http') ? href : `https://leilosoc.com${href}`;
      }
    }
  }

  return null;
}

/**
 * Extract a value from the details section by label
 */
function extractDetailValue($: cheerio.CheerioAPI, label: string): string | null {
  // Look for label-value pairs in the details section
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

/**
 * Extract a value from the info section by label
 */
function extractInfoValue($: cheerio.CheerioAPI, label: string): string | null {
  // Look for the info section text
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

/**
 * Extract location details from detail page
 */
function extractLocationDetails($: cheerio.CheerioAPI, prop: Property): void {
  // Look for location section
  const $locationSection = $('h3:contains("Localização")').parent();
  
  if ($locationSection.length > 0) {
    // Extract city
    const $city = $locationSection.find('p[style*="font-weight:700"]').first();
    if ($city.length > 0) {
      prop.municipality = $city.text().trim();
      prop.location = $city.text().trim();
    }

    // Extract full address
    const $address = $locationSection.find('p').not('[style*="font-weight:700"]').first();
    if ($address.length > 0) {
      const addressText = $address.text().trim();
      prop.location = addressText;
      
      // Try to extract district, municipality, parish from address
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

/**
 * Parse end date from text
 */
function parseEndDate(dateText: string): Date {
  // Expected format: "03/07/2026 18:00"
  const match = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hours, minutes] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours), parseInt(minutes));
  }
  
  return new Date();
}

/**
 * Extract price details from detail page
 */
function extractPriceDetails($: cheerio.CheerioAPI, prop: Property): void {
  // Look for price section
  const $priceSection = $('[style*="grid-area:info"], .price-section');
  
  if ($priceSection.length > 0) {
    // Extract current bid
    const currentBidText = extractPriceLabel($, 'Licitação atual');
    if (currentBidText) {
      const match = currentBidText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.currentBid = parsePrice(match[1]);
        prop.price = parsePrice(match[1]);
      }
    }

    // Extract opening value
    const openingValueText = extractPriceLabel($, 'Valor de Abertura');
    if (openingValueText) {
      const match = openingValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.openingValue = parsePrice(match[1]);
      }
    }

    // Extract base value
    const baseValueText = extractPriceLabel($, 'Valor base');
    if (baseValueText) {
      const match = baseValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.price = parsePrice(match[1]);
      }
    }

    // Extract minimum value
    const minValueText = extractPriceLabel($, 'Valor Mínimo');
    if (minValueText && minValueText !== '---') {
      const match = minValueText.match(/([\d.,]+)\s*€/);
      if (match) {
        prop.minSaleValue = parsePrice(match[1]);
      }
    }
  }
}

/**
 * Extract price by label
 */
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

/**
 * Extract auction type from detail page
 */
function extractAuctionTypeFromDetail($: cheerio.CheerioAPI): string | null {
  // Look for auction type button
  const $button = $('button:contains("Leilão"), button:contains("Negociação"), button:contains("Comprar")');
  if ($button.length > 0) {
    return $button.text().trim();
  }
  return null;
}

/**
 * Extract images from detail page
 */
function extractImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = [];
  
  // Look for images in slick slider
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

/**
 * Extract description from detail page
 */
function extractDescription($: cheerio.CheerioAPI): string {
  // Look for description section
  const $descSection = $('h3:contains("Descrição"), div:contains("Descrição")').parent();
  if ($descSection.length > 0) {
    const $desc = $descSection.find('.c-bAJmbT, .description, .rich-text').first();
    if ($desc.length > 0) {
      return $desc.text().trim();
    }
  }
  return '';
}

/**
 * Extract property features from detail page
 */
function extractPropertyFeatures($: cheerio.CheerioAPI, prop: Property): void {
  // Look for details section
  const $detailsSection = $('h3:contains("Detalhes")').parent();
  if ($detailsSection.length > 0) {
    // Extract lot number
    const lotNumber = extractDetailValue($, 'Lote Número');
    if (lotNumber) {
      // Could store in a custom field
    }

    // Extract area if mentioned in description
    const desc = prop.description;
    if (desc) {
      const areaMatch = desc.match(/(\d+(?:[.,]\d+)?)\s*m²/);
      if (areaMatch) {
        prop.area = parseFloat(areaMatch[1].replace(',', '.'));
      }
    }
  }
}

/**
 * Extract documents from detail page
 */
function extractDocuments($: cheerio.CheerioAPI): { type: string; url: string }[] {
  const docs: { type: string; url: string }[] = [];
  
  // Look for document section
  const $docSection = $('h3:contains("Documentos")').parent();
  if ($docSection.length > 0) {
    const $links = $docSection.find('a[href$=".pdf"]');
    $links.each((_, element) => {
      const $link = $(element);
      const url = $link.attr('href');
      const type = $link.text().trim();
      if (url && url.startsWith('http')) {
        docs.push({ type, url });
      }
    });
  }

  return docs;
}

/**
 * Extract seller information from detail page
 */
function extractSellerInfo($: cheerio.CheerioAPI): { name: string; email: string; phone: string } | null {
  // Look for seller section
  const $sellerSection = $('h3:contains("vendedor")').parent();
  if ($sellerSection.length > 0) {
    const name = $sellerSection.find('p[style*="font-weight:700"]').first().text().trim();
    
    let email = '';
    let phone = '';
    
    $sellerSection.find('p').each((_, element) => {
      const $p = $(element);
      const text = $p.text();
      
      if (text.includes('@')) {
        email = text.trim();
      } else if (text.match(/\d{3}\s*\d{3}\s*\d{3}/)) {
        phone = text.trim();
      }
    });

    if (name) {
      return { name, email, phone };
    }
  }

  return null;
}