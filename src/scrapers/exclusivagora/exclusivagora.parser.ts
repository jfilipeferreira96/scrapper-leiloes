import * as cheerio from 'cheerio';
import { parsePrice } from '../../utils/parser.js';

export interface ExclusivagoraListing {
  externalId: string;
  title: string;
  location: string;
  auctionType: string;
  startDate: string;
  endDate: string;
  image: string;
  detailUrl: string;
  detailPageType: 'info' | 'detail';
}

export interface ExclusivagoraDetail {
  title: string;
  location: string;
  auctionType: string;
  description: string;
  notes: string;
  images: string[];
  price: number;
  minSaleValue: number;
  openingValue: number;
  currentBid: number;
  documents: string[];
  countdown: string;
}

/**
 * Parse listing page to extract property listings
 */
export function parseListings(html: string): ExclusivagoraListing[] {
  const $ = cheerio.load(html);
  const listings: ExclusivagoraListing[] = [];

  $('.list-grid-option').each((_, element) => {
    const $item = $(element);

    // Extract detail URL and ID
    const detailHref = $item.find('.listings-img').attr('href') || '';
    const vendaMatch = detailHref.match(/venda=(\d+)/);
    const externalId = vendaMatch ? vendaMatch[1] : '';

    // Determine detail page type
    const detailPageType = detailHref.includes('vendas-detail') ? 'detail' : 'info';

    // Extract image from background-image style
    const bgStyle = $item.find('.listings-img').attr('style') || '';
    const imageMatch = bgStyle.match(/url\(['"]?([^'")]+)['"]?\)/);
    const image = imageMatch ? imageMatch[1] : '';

    // Extract dates
    const startDate = $item.find('.listings-text-block-left').text().trim();
    const endDate = $item.find('.listings-text-block-right').text().trim();

    // Extract auction type - take only the first occurrence
    const auctionTypeElement = $item.find('h4.font-10-400-uc.purpure').first();
    const auctionType = auctionTypeElement.text().trim();

    // Extract title - take only the first occurrence
    const titleElement = $item.find('h2.font-20-700-uc.mt-3.pupure').first();
    const title = titleElement.text().trim();

    // Extract location - take only the first occurrence
    const locationElement = $item.find('h5.font-08-700-uc.mt-3.light-pink.notranslate').first();
    const location = locationElement.text().trim();

    if (externalId && title) {
      listings.push({
        externalId,
        title,
        location,
        auctionType,
        startDate,
        endDate,
        image,
        detailUrl: `https://www.exclusivagora.com/${detailHref.replace(/^\.\//, '')}`,
        detailPageType
      });
    }
  });

  return listings;
}

/**
 * Parse detail page to extract property details
 */
export function parseDetail(html: string): ExclusivagoraDetail | null {
  const $ = cheerio.load(html);

  // Extract title
  const title = $('h2.font-24-700-uc.mt-3.pupure').text().trim() ||
                $('h2.font-20-700-uc.mt-3.pupure').text().trim();

  if (!title) {
    return null;
  }

  // Extract location
  const location = $('h5.font-14-700-uc.mt-3.white.light-pink.notranslate').text().trim() ||
                   $('h5.font-08-700-uc.mt-3.light-pink.notranslate').text().trim();

  // Extract auction type - take only the first occurrence
  const auctionType = $('h4.font-10-400-uc.purpure').first().text().trim();

  // Extract countdown
  const countdown = $('#defaultCountdown').text().trim();

  // Extract prices - need to handle multiple elements with same ID
  const valorBaseElements = $('span#valor-base');
  const price = parsePrice(valorBaseElements.eq(0).text().trim());
  const minSaleValue = parsePrice(valorBaseElements.eq(1).text().trim());
  const openingValue = parsePrice(valorBaseElements.eq(2).text().trim());
  const currentBid = parsePrice($('span#valor-actual').text().trim());

  // Extract images from carousel
  const images: string[] = [];
  $('.carousel-item img').each((_, element) => {
    const src = $(element).attr('src');
    if (src && !src.startsWith('data:')) {
      const fullUrl = src.startsWith('http') ? src : `https://www.exclusivagora.com${src}`;
      if (!images.includes(fullUrl)) {
        images.push(fullUrl);
      }
    }
  });

  // Extract description (after "Descrição" label)
  let description = '';
  const descriptionLabel = $('p.font-15-400-uc.light-pink').filter((_, el) => 
    $(el).text().trim() === 'Descrição'
  );
  if (descriptionLabel.length > 0) {
    description = descriptionLabel.next('p.font-10-400-lc.purpure.pt-1.justify').text().trim();
  }

  // Extract notes (after "Notas" label)
  let notes = '';
  const notesLabel = $('p.font-15-400-uc.light-pink').filter((_, el) => 
    $(el).text().trim() === 'Notas'
  );
  if (notesLabel.length > 0) {
    notes = notesLabel.next('p.font-10-400-lc.purpure.pt-1.justify').text().trim();
  }

  // Extract documents
  const documents: string[] = [];
  $('.btn-primary.btn-purpure-small, .btn-primary.btn-purpure').each((_, element) => {
    const href = $(element).attr('href');
    if (href && (href.includes('.pdf') || href.includes('docs/'))) {
      const fullUrl = href.startsWith('http') ? href : `https://www.exclusivagora.com/${href}`;
      if (!documents.includes(fullUrl)) {
        documents.push(fullUrl);
      }
    }
  });

  return {
    title,
    location,
    auctionType,
    description,
    notes,
    images,
    price,
    minSaleValue,
    openingValue,
    currentBid,
    documents,
    countdown
  };
}

/**
 * Parse countdown string to determine auction status
 */
export function parseStatus(countdown: string): string {
  if (!countdown || countdown.includes('0d 0h 0m 0s')) {
    return 'closed';
  }
  return 'active';
}