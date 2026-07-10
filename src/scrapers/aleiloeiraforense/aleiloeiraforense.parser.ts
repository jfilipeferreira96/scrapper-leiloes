/**
 * Aleiloeira Forense Parser.
 *
 * Parses property auction data from www.aleiloeiraforense.pt.
 *
 * Listing page: ?chkimoveis=I&selectdistrito=0&q=
 *   - Items in .lista_vendas container
 *   - Each item has title, description, price (Valor Base), process number, image
 *
 * Detail page: ?page=leilao&leilao=XXX&venda=YYY&tipo=Z
 *   - Additional details, images, auction dates
 */

import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice } from '../../utils/parser.js';

const BASE_URL = 'https://www.aleiloeiraforense.pt';

/**
 * Parse the listing page for property auction items.
 *
 * Each item in .lista_vendas contains:
 *  - h1 (title, e.g. "Lote 20")
 *  - .texto_lote (description with process number)
 *  - .infobox_valorbase (Valor Base price)
 *  - .infobox_valoractual (current bid)
 *  - img (property image)
 *  - .tipo_leilao_pesq (auction type)
 *  - Link to detail page
 */
export function parseAleiloeiraforenseListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  // Each auction item is in a section with a link to ?page=leilao
  const seenUrls = new Set<string>();

  $('a[href*="page=leilao"]').each((_, element) => {
    const $el = $(element);
    const href = $el.attr('href') || '';

    // Skip duplicate URLs (each item has multiple links)
    if (seenUrls.has(href)) return;
    seenUrls.add(href);

    // Navigate up to find the parent container with all data
    const $container = $el.closest('.post_content, .section, .row-fluid').first();
    if (!$container.length) return;

    // Only process if this container has the listing data
    const $listingSection = $container.closest('.lista_vendas, .home_block_advert').length > 0
      ? $container.closest('.home_block_advert, .section')
      : $container;

    // Extract title from h1
    const title = $listingSection.find('h1').first().text().trim();
    if (!title) return;

    // Build full URL
    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\.\//, '')}`;

    // Extract external ID from URL params
    const leilaoMatch = href.match(/leilao=(\d+)/);
    const vendaMatch = href.match(/venda=(\d+)/);
    const externalId = leilaoMatch && vendaMatch
      ? `${leilaoMatch[1]}_${vendaMatch[1]}`
      : leilaoMatch ? leilaoMatch[1] : href;

    // Extract description from .texto_lote
    const descriptionHtml = $listingSection.find('.texto_lote').html() || '';
    const description = $listingSection.find('.texto_lote').text().trim();

    // Extract process number from description
    const processMatch = description.match(/Processo:\s*([A-Za-z0-9/\.\-]+)/i);
    const processNumber = processMatch ? processMatch[1] : undefined;

    // Extract Valor Base (opening/base price)
    const valorBaseText = $listingSection.find('.infobox_valorbase p').text().trim();
    const valorBase = parsePrice(valorBaseText);

    // Extract Valor Actual (current bid)
    const valorActualText = $listingSection.find('.infobox_valoractual p').text().trim();
    const valorActual = parsePrice(valorActualText);

    // Extract auction type
    const auctionTypeText = $listingSection.find('.tipo_leilao_pesq').text().trim();
    const auctionType = auctionTypeText || 'Leilão Eletrónico';

    // Extract end time from JavaScript (lasttime variable)
    const scriptText = $listingSection.find('script').text() || '';
    const lasttimeMatch = scriptText.match(/lasttime\s*=\s*(\d+)/);
    let endDate: Date | undefined;
    if (lasttimeMatch) {
      const timestamp = parseInt(lasttimeMatch[1], 10);
      endDate = new Date(timestamp * 1000); // Unix timestamp in seconds
    }

    // Extract image
    const imgSrc = $listingSection.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}/${imgSrc.replace(/^\.\//, '')}`);
    }

    // Extract catalog link
    const catalogLink = $listingSection.find('a[href*="docs/ctm"]').attr('href');

    // Build location from description (try to extract city/district)
    let location = '';
    const locationMatch = description.match(/(?:sito|localizado|situado)\s+(?:em|no|na)\s+([A-Za-zÀ-ÿ\s,]+?)(?:\.|,|;|descrito)/i);
    if (locationMatch) {
      location = locationMatch[1].trim();
    }

    // Build full description
    let fullDescription = description;
    if (processNumber) {
      fullDescription += `\n\nProcesso: ${processNumber}`;
    }
    if (catalogLink) {
      const fullCatalog = catalogLink.startsWith('http') ? catalogLink : `${BASE_URL}/${catalogLink.replace(/^\.\//, '')}`;
      fullDescription += `\nCertidão: ${fullCatalog}`;
    }

    const property: Property = {
      source: 'aleiloeiraforense',
      externalId,
      title,
      description: fullDescription || undefined,
      price: valorBase,
      openingValue: valorBase > 0 ? valorBase : undefined,
      currentBid: valorActual > 0 ? valorActual : undefined,
      location,
      url: fullUrl,
      images,
      auctionType,
      status: 'active',
      publishedAt: endDate,
    };

    properties.push(property);
  });

  return properties;
}

/**
 * Parse a detail page for enriched data.
 *
 * Detail pages have additional images, full description, and lot details.
 */
export function parseAleiloeiraforenseDetail(html: string, base: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  // Extract title
  const title = $('h1, h2').first().text().trim();
  if (title && title !== 'INÍCIO DE SESSÃO') {
    result.title = title;
  }

  // Extract description
  const description = $('.texto_lote, .post_content p, .description').text().trim();
  if (description) {
    result.description = description;
  }

  // Extract all images
  const images: string[] = [];
  $('img[src*="images/"], img[src*="upload"]').each((_, img) => {
    const src = $(img).attr('src') || '';
    if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner')) {
      const fullSrc = src.startsWith('http') ? src : `${BASE_URL}/${src.replace(/^\.\//, '')}`;
      if (!images.includes(fullSrc)) {
        images.push(fullSrc);
      }
    }
  });
  if (images.length > 0) result.images = images;

  // Extract prices
  const valorBaseText = $('.infobox_valorbase p, .valor_base').text().trim();
  const valorBase = parsePrice(valorBaseText);
  if (valorBase > 0) {
    result.price = valorBase;
    result.openingValue = valorBase;
  }

  // Extract process number
  const processMatch = (description || '').match(/Processo:\s*([A-Za-z0-9/\.\-]+)/i);
  if (processMatch && !result.description?.includes('Processo:')) {
    result.description = `${result.description || ''}\n\nProcesso: ${processMatch[1]}`.trim();
  }

  // Extract tribunal
  const tribunalMatch = (description || '').match(/(?:Tribunal|Comarca)[:\s]*([^\n.;]+)/i);
  if (tribunalMatch) {
    result.description = `${result.description || ''}\nTribunal: ${tribunalMatch[1].trim()}`.trim();
  }

  return result;
}
