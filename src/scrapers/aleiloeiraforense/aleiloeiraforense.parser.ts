import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice } from '../../utils/parser.js';

const BASE_URL = 'https://www.aleiloeiraforense.pt';

export function parseAleiloeiraforenseListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  const seenUrls = new Set<string>();

  $('a[href*="page=leilao"]').each((_, element) => {
    const $el = $(element);
    const href = $el.attr('href') || '';

    // each item has multiple links to the same detail page
    if (seenUrls.has(href)) return;
    seenUrls.add(href);

    const $container = $el.closest('.post_content, .section, .row-fluid').first();
    if (!$container.length) return;

    const $listingSection = $container.closest('.lista_vendas, .home_block_advert').length > 0
      ? $container.closest('.home_block_advert, .section')
      : $container;

    const title = $listingSection.find('h1').first().text().trim();
    if (!title) return;

    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\.\//, '')}`;

    const leilaoMatch = href.match(/leilao=(\d+)/);
    const vendaMatch = href.match(/venda=(\d+)/);
    const externalId = leilaoMatch && vendaMatch
      ? `${leilaoMatch[1]}_${vendaMatch[1]}`
      : leilaoMatch ? leilaoMatch[1] : href;

    const descriptionHtml = $listingSection.find('.texto_lote').html() || '';
    const description = $listingSection.find('.texto_lote').text().trim();

    const processMatch = description.match(/Processo:\s*([A-Za-z0-9/\.\-]+)/i);
    const processNumber = processMatch ? processMatch[1] : undefined;

    const valorBaseText = $listingSection.find('.infobox_valorbase p').text().trim();
    const valorBase = parsePrice(valorBaseText);

    const valorActualText = $listingSection.find('.infobox_valoractual p').text().trim();
    const valorActual = parsePrice(valorActualText);

    const auctionTypeText = $listingSection.find('.tipo_leilao_pesq').text().trim();
    const auctionType = auctionTypeText || 'Leilão Eletrónico';

    // end time comes from a JS variable: lasttime = <unix seconds>
    const scriptText = $listingSection.find('script').text() || '';
    const lasttimeMatch = scriptText.match(/lasttime\s*=\s*(\d+)/);
    let endDate: Date | undefined;
    if (lasttimeMatch) {
      endDate = new Date(parseInt(lasttimeMatch[1], 10) * 1000);
    }

    const imgSrc = $listingSection.find('img').first().attr('src') || '';
    const images: string[] = [];
    if (imgSrc) {
      images.push(imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}/${imgSrc.replace(/^\.\//, '')}`);
    }

    const catalogLink = $listingSection.find('a[href*="docs/ctm"]').attr('href');

    let location = '';
    const locationMatch = description.match(/(?:sito|localizado|situado)\s+(?:em|no|na)\s+([A-Za-zÀ-ÿ\s,]+?)(?:\.|,|;|descrito)/i);
    if (locationMatch) {
      location = locationMatch[1].trim();
    }

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

export function parseAleiloeiraforenseDetail(html: string, base: Property): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const title = $('h1, h2').first().text().trim();
  if (title && title !== 'INÍCIO DE SESSÃO') {
    result.title = title;
  }

  const description = $('.texto_lote, .post_content p, .description').text().trim();
  if (description) {
    result.description = description;
  }

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

  const valorBaseText = $('.infobox_valorbase p, .valor_base').text().trim();
  const valorBase = parsePrice(valorBaseText);
  if (valorBase > 0) {
    result.price = valorBase;
    result.openingValue = valorBase;
  }

  const processMatch = (description || '').match(/Processo:\s*([A-Za-z0-9/\.\-]+)/i);
  if (processMatch && !result.description?.includes('Processo:')) {
    result.description = `${result.description || ''}\n\nProcesso: ${processMatch[1]}`.trim();
  }

  const tribunalMatch = (description || '').match(/(?:Tribunal|Comarca)[:\s]*([^\n.;]+)/i);
  if (tribunalMatch) {
    result.description = `${result.description || ''}\nTribunal: ${tribunalMatch[1].trim()}`.trim();
  }

  return result;
}
