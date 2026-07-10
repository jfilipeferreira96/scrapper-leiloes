/**
 * Imoloriente Parser.
 *
 * Parses property auction data from www.imoloriente.pt (WordPress + WooCommerce).
 *
 * Listing page: /categoria-produto/imoveis/
 *   - Products in <li class="product-col ..."> elements
 *   - WooCommerce auction plugin data
 *
 * Detail page: /bolsa-de-negocios/imoveis/...
 *   - Full description, auction dates, prices, images, location
 */

import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice, parsePortugueseDate } from '../../utils/parser.js';

const BASE_URL = 'https://www.imoloriente.pt';

/**
 * Parse the WooCommerce product listing page.
 *
 * Each product is in an <li> with class "product-col" containing:
 *  - .product-inner wrapper
 *  - h3 > a (title + link)
 *  - .price (auction price)
 *  - .auction (countdown / auction status)
 *  - img (product image)
 */
export function parseImolorienteListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('li.product-col').each((_, element) => {
    const $el = $(element);

    // Extract product ID from class (post-XXXXX)
    const classes = $el.attr('class') || '';
    const postIdMatch = classes.match(/post-(\d+)/);
    const externalId = postIdMatch ? postIdMatch[1] : '';

    // Extract title and link
    const $titleLink = $el.find('h3 a, .product-inner h3 a, h3').first();
    const title = $titleLink.text().trim() || $el.find('h3').text().trim();
    let href = $titleLink.attr('href') || $el.find('a').first().attr('href') || '';

    if (!title || !href) return;

    if (href && !href.startsWith('http')) {
      href = `${BASE_URL}${href}`;
    }

    // Extract price from .price element
    const priceText = $el.find('.price .amount, .price').last().text().trim();
    const price = parsePrice(priceText);

    // Extract auction status from .auction element
    const auctionText = $el.find('.auction').first().text().trim();
    const auctionType = auctionText.includes('Leilão') ? 'Leilão Eletrónico' : 'Venda Direta';

    // Check if auction is finished
    const status = auctionText.toLowerCase().includes('encerrad') ? 'closed' : 'active';

    // Extract image
    const imgSrc = $el.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`);
    }

    // Extract end date from countdown
    let endDate: Date | undefined;
    const countdownText = $el.find('.auction .countdown, .auction_time').text().trim();
    if (countdownText) {
      endDate = parsePortugueseDate(countdownText);
    }

    // Extract location from tags (product_tag classes contain location info)
    const tagClasses = classes.match(/product_tag-([a-z0-9-]+)/g) || [];
    const tags = tagClasses.map(t => t.replace('product_tag-', '').replace(/-/g, ' '));
    const location = tags.length > 0 ? tags.join(', ') : '';

    const property: Property = {
      source: 'imoloriente',
      externalId,
      title,
      price,
      location,
      url: href,
      images,
      auctionType,
      status,
      publishedAt: endDate,
    };

    properties.push(property);
  });

  return properties;
}

/**
 * Parse a product detail page for enriched data.
 *
 * WooCommerce product pages contain:
 *  - .product_title (full title)
 *  - .woocommerce-product-details__short-description (summary)
 *  - .auction (prices, dates, bid info)
 *  - .woocommerce-product-gallery (images)
 *  - .posted_in / .tagged_as (categories/tags with location)
 */
export function parseImolorienteDetail(html: string, baseUrl: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  // Extract full title
  const title = $('.product_title, h1.product_title, h1.entry-title').first().text().trim();
  if (title) result.title = title;

  // Extract short description
  const shortDesc = $('.woocommerce-product-details__short-description, .short-description').text().trim();

  // Extract full description
  const fullDesc = $('#tab-description, .description, .woocommerce-Tabs-panel--description').text().trim();
  if (fullDesc || shortDesc) {
    result.description = fullDesc || shortDesc;
  }

  // Extract prices
  const priceText = $('.woocommerce-Price-amount, .price .amount, p.price').last().text().trim();
  const price = parsePrice(priceText);
  if (price > 0) result.price = price;

  // Extract auction values
  const auctionInfo = $('.auction, .auction_info').text();
  // Look for "Valor de abertura" / "Valor mínimo" patterns
  const openingMatch = auctionInfo.match(/(?:abertura|base)[^:]*:?\s*([\d.]+,\d{2})/i);
  const minMatch = auctionInfo.match(/(?:m[ií]nimo)[^:]*:?\s*([\d.]+,\d{2})/i);
  if (openingMatch) result.openingValue = parsePrice(openingMatch[1]);
  if (minMatch) result.minSaleValue = parsePrice(minMatch[1]);

  // Extract current bid
  const currentBidText = $('.auction .current_bid, .auction_current_bid').text().trim();
  const currentBid = parsePrice(currentBidText);
  if (currentBid > 0) result.currentBid = currentBid;

  // Extract dates
  const dateText = $('.auction_dates, .auction .date').text();
  const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  if (dateMatch) {
    result.publishedAt = new Date(dateMatch[1]);
  }

  // Extract all gallery images
  const images: string[] = [];
  $('.woocommerce-product-gallery__image img, .flex-control-nav img, .product-gallery img').each((_, img) => {
    const src = $(img).attr('src') || $(img).attr('data-src') || '';
    if (src && !src.includes('placeholder')) {
      images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
    }
  });
  if (images.length > 0) result.images = images;

  // Extract location from tags
  const tagText = $('.tagged_as, .product_meta .tagged_as, .posted_in').text();
  if (tagText) {
    const tags = tagText.replace(/.*:/, '').split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length > 0 && !result.location) {
      result.location = tags.join(', ');
    }
  }

  // Extract reference/process number from description
  const refMatch = (fullDesc || '').match(/(?:Referência|Ref\.?|Processo)[:\s]*([A-Za-z0-9/\.\-]+)/i);
  if (refMatch) {
    result.description = `${result.description || ''}\n\nReferência: ${refMatch[1]}`.trim();
  }

  // Extract tribunal from description
  const tribunalMatch = (fullDesc || '').match(/(?:Tribunal|Comarca)[:\s]*([^\n.]+)/i);
  if (tribunalMatch) {
    result.description = `${result.description || ''}\nTribunal: ${tribunalMatch[1].trim()}`.trim();
  }

  return result;
}
