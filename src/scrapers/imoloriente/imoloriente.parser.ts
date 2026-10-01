// WordPress + WooCommerce with an auction plugin
import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice, parsePortugueseDate } from '../../utils/parser.js';

const BASE_URL = 'https://www.imoloriente.pt';

export function parseImolorienteListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('li.product-col').each((_, element) => {
    const $el = $(element);

    // product id from the post-XXXXX class
    const classes = $el.attr('class') || '';
    const postIdMatch = classes.match(/post-(\d+)/);
    const externalId = postIdMatch ? postIdMatch[1] : '';

    const $titleLink = $el.find('h3 a, .product-inner h3 a, h3').first();
    const title = $titleLink.text().trim() || $el.find('h3').text().trim();
    let href = $titleLink.attr('href') || $el.find('a').first().attr('href') || '';

    if (!title || !href) return;

    if (href && !href.startsWith('http')) {
      href = `${BASE_URL}${href}`;
    }

    const priceText = $el.find('.price .amount, .price').last().text().trim();
    const price = parsePrice(priceText);

    const auctionText = $el.find('.auction').first().text().trim();
    const auctionType = auctionText.includes('Leilão') ? 'Leilão Eletrónico' : 'Venda Direta';

    const status = auctionText.toLowerCase().includes('encerrad') ? 'closed' : 'active';

    const imgSrc = $el.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`);
    }

    let endDate: Date | undefined;
    const countdownText = $el.find('.auction .countdown, .auction_time').text().trim();
    if (countdownText) {
      endDate = parsePortugueseDate(countdownText);
    }

    // product_tag classes hold the location
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

export function parseImolorienteDetail(html: string, baseUrl: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const title = $('.product_title, h1.product_title, h1.entry-title').first().text().trim();
  if (title) result.title = title;

  const shortDesc = $('.woocommerce-product-details__short-description, .short-description').text().trim();

  const fullDesc = $('#tab-description, .description, .woocommerce-Tabs-panel--description').text().trim();
  if (fullDesc || shortDesc) {
    result.description = fullDesc || shortDesc;
  }

  const priceText = $('.woocommerce-Price-amount, .price .amount, p.price').last().text().trim();
  const price = parsePrice(priceText);
  if (price > 0) result.price = price;

  const auctionInfo = $('.auction, .auction_info').text();
  const openingMatch = auctionInfo.match(/(?:abertura|base)[^:]*:?\s*([\d.]+,\d{2})/i);
  const minMatch = auctionInfo.match(/(?:m[ií]nimo)[^:]*:?\s*([\d.]+,\d{2})/i);
  if (openingMatch) result.openingValue = parsePrice(openingMatch[1]);
  if (minMatch) result.minSaleValue = parsePrice(minMatch[1]);

  const currentBidText = $('.auction .current_bid, .auction_current_bid').text().trim();
  const currentBid = parsePrice(currentBidText);
  if (currentBid > 0) result.currentBid = currentBid;

  const dateText = $('.auction_dates, .auction .date').text();
  const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  if (dateMatch) {
    result.publishedAt = new Date(dateMatch[1]);
  }

  const images: string[] = [];
  $('.woocommerce-product-gallery__image img, .flex-control-nav img, .product-gallery img').each((_, img) => {
    const src = $(img).attr('src') || $(img).attr('data-src') || '';
    if (src && !src.includes('placeholder')) {
      images.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
    }
  });
  if (images.length > 0) result.images = images;

  const tagText = $('.tagged_as, .product_meta .tagged_as, .posted_in').text();
  if (tagText) {
    const tags = tagText.replace(/.*:/, '').split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length > 0 && !result.location) {
      result.location = tags.join(', ');
    }
  }

  const refMatch = (fullDesc || '').match(/(?:Referência|Ref\.?|Processo)[:\s]*([A-Za-z0-9/\.\-]+)/i);
  if (refMatch) {
    result.description = `${result.description || ''}\n\nReferência: ${refMatch[1]}`.trim();
  }

  const tribunalMatch = (fullDesc || '').match(/(?:Tribunal|Comarca)[:\s]*([^\n.]+)/i);
  if (tribunalMatch) {
    result.description = `${result.description || ''}\nTribunal: ${tribunalMatch[1].trim()}`.trim();
  }

  return result;
}
