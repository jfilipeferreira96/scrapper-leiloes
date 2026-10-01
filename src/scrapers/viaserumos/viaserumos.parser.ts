import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice, parsePortugueseDate } from '../../utils/parser.js';

const BASE_URL = 'https://viaserumos.pt';

export function parseViaserumosListing(html: string): Property[] {
  const $ = cheerio.load(html);
  const properties: Property[] = [];

  $('.brxe-gemued').each((_, element) => {
    const $el = $(element);
    const $link = $el.find('a').first();
    const href = $link.attr('href');
    
    if (!href) return;

    const reference = $el.find('.referencia_leilao_terminar').text().trim();
    const externalId = reference || href.split('/').filter(Boolean).pop() || '';
    
    // Extract description (seller name)
    const description = $el.find('.acf_descricao').text().trim();
    const title = $el.find('.titulo4').text().trim();
    const location = $el.find('.localizacao_leiloes_terminar').text().trim();
    
    // Extract end date from countdown JSON
    const countdownEl = $el.find('.countdown').first();
    const countdownOptions = countdownEl.attr('data-bricks-countdown-options');
    let endDate: Date | undefined;
    if (countdownOptions) {
      try {
        const options = JSON.parse(countdownOptions);
        if (options.date) {
          endDate = new Date(options.date);
        }
      } catch (e) {
        // Invalid JSON, skip date
      }
    }
    
    const auctionInfo = $el.find('.lote_n_leiloes_terminar').toArray();
    const auctionType = $(auctionInfo[0]).text().trim();
    const numItemsText = $(auctionInfo[1]).text().trim();
    const numItemsMatch = numItemsText.match(/nº Verbas:\s*(\d+)/);
    const numItems = numItemsMatch ? parseInt(numItemsMatch[1], 10) : undefined;
    
    const image = $el.find('.imagem_bloco_leiloes_terminar img').attr('src');
    
    let fullDescription = description || '';
    if (numItems) {
      fullDescription += `\n\nNúmero de verbas: ${numItems}`;
    }
    
    const property: Property = {
      source: 'viaserumos',
      externalId,
      title,
      description: fullDescription || undefined,
      price: 0, // Will be enriched from detail page
      location,
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      images: image ? [image] : [],
      auctionType: auctionType,
      status: 'active',
      publishedAt: endDate,
    };

    properties.push(property);
  });

  return properties;
}

export function parseViaserumosDetail(html: string, url: string): Partial<Property> {
  const $ = cheerio.load(html);
  const result: Partial<Property> = {};

  const reference = $('.referencia_leilao_destaque').text().trim();
  if (reference) result.externalId = reference;

  // Extract process number (second .data_inicio_leilao in the block)
  const processInfo = $('.data_inicio_leilao').toArray();
  let processNumber: string | undefined;
  if (processInfo.length >= 2) {
    const pn = $(processInfo[1]).text().trim();
    if (pn && pn.includes('/')) {
      processNumber = pn;
    }
  }

  const titles = $('.titulo_leilao_desatque').toArray();
  let name: string | undefined;
  let title: string | undefined;
  if (titles.length >= 2) {
    name = $(titles[0]).text().trim();
    title = $(titles[1]).text().trim();
  }

  const location = $('.bloco_localizacao_leilao_destaque a').text().trim();
  if (location) result.location = location;

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (processInfo.length >= 4) {
    const startDateText = $(processInfo[0]).text().trim();
    const endDateText = $(processInfo[2]).text().trim();
    
    if (startDateText) {
      startDate = parsePortugueseDate(startDateText);
    }
    
    if (endDateText) {
      endDate = parsePortugueseDate(endDateText);
    }
  }

  let tribunal: string | undefined;
  if (processInfo.length >= 4) {
    const t = $(processInfo[3]).text().trim();
    if (t && !t.includes('/')) {
      tribunal = t;
    }
  }

  const catalogLink = $('.bloco_pagina_lote_4colunas a').attr('href');
  let catalogUrl: string | undefined;
  if (catalogLink) {
    catalogUrl = catalogLink.startsWith('http') ? catalogLink : `${BASE_URL}${catalogLink}`;
  }

  const mainImages: string[] = [];
  $('.brxe-image.imagem_bloco_leiloes_terminar img').each((_, imgEl) => {
    const $img = $(imgEl);
    const src = $img.attr('src');
    if (src) {
      mainImages.push(src.startsWith('http') ? src : `${BASE_URL}${src}`);
    }
  });

  const verbas: any[] = [];
  let totalPrice = 0;
  const images: string[] = [];

  $('.bloco_verbas').each((_, verbaEl) => {
    const $verba = $(verbaEl);
    const verbaNumber = $verba.find('.bloco_interno_verbas_titulo_btn span').text().trim();
    const verbaTitle = $verba.find('.titulo_bloco_verba').text().trim();
    const verbaLocation = $verba.find('.localizacao_verba').text().trim();
    const verbaDescription = $verba.find('.body1').text().trim();
    const valueItems = $verba.find('.verbas_topicos').toArray();
    const type = valueItems.length > 0 ? $(valueItems[0]).text().trim() : undefined;
    const subtype = valueItems.length > 1 ? $(valueItems[1]).text().trim() : undefined;
    const baseValueText = valueItems.length > 2 ? $(valueItems[2]).text().trim() : undefined;
    const minValueText = valueItems.length > 3 ? $(valueItems[3]).text().trim() : undefined;
    const currentValueText = valueItems.length > 4 ? $(valueItems[4]).text().trim() : undefined;
    
    const baseValue = baseValueText ? parsePrice(baseValueText) : 0;
    const minValue = minValueText ? parsePrice(minValueText) : 0;
    const currentValue = currentValueText && !currentValueText.toLowerCase().includes('sem') 
      ? parsePrice(currentValueText) 
      : 0;
    
    const price = currentValue > 0 ? currentValue : baseValue;
    totalPrice += price;

    // images are swiper slides: background-image lives in data-style
    $verba.find('.swiper-slide .image').each((_, imgEl) => {
      const $img = $(imgEl);
      const dataStyle = $img.attr('data-style') || '';
      if (dataStyle) {
        const urlMatch = dataStyle.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const imgUrl = urlMatch[1].startsWith('http') ? urlMatch[1] : `${BASE_URL}${urlMatch[1]}`;
          images.push(imgUrl);
        }
      }
    });

    verbas.push({
      number: verbaNumber,
      title: verbaTitle,
      location: verbaLocation,
      description: verbaDescription,
      type,
      subtype,
      baseValue,
      minValue,
      currentValue,
      price,
    });
  });

  result.price = totalPrice;
  const allImages = [...mainImages, ...images];
  if (allImages.length > 0) result.images = allImages;
  result.publishedAt = endDate;

  // Set openingValue and minSaleValue from first verba if available
  if (verbas.length > 0) {
    const firstVerba = verbas[0];
    if (firstVerba.baseValue > 0) result.openingValue = firstVerba.baseValue;
    if (firstVerba.minValue > 0) result.minSaleValue = firstVerba.minValue;
    if (firstVerba.currentValue > 0) result.currentBid = firstVerba.currentValue;
  }

  let descriptionParts: string[] = [];
  if (name) descriptionParts.push(name);
  if (title) descriptionParts.push(title);
  if (processNumber) descriptionParts.push(`Processo: ${processNumber}`);
  if (tribunal) descriptionParts.push(`Tribunal: ${tribunal}`);
  if (startDate) descriptionParts.push(`Início: ${startDate.toLocaleString('pt-PT')}`);
  if (endDate) descriptionParts.push(`Fim: ${endDate.toLocaleString('pt-PT')}`);
  if (verbas.length > 0) {
    descriptionParts.push(`\nVerbas: ${verbas.length}`);
    verbas.forEach((v, i) => {
      descriptionParts.push(`\n${v.number || (i + 1)}: ${v.title}`);
      if (v.location) descriptionParts.push(`  Localização: ${v.location}`);
      if (v.price > 0) descriptionParts.push(`  Valor: ${v.price.toFixed(2)} €`);
      if (v.description) descriptionParts.push(`  ${v.description.substring(0, 200)}...`);
    });
  }
  if (catalogUrl) descriptionParts.push(`\nCatálogo: ${catalogUrl}`);
  
  result.description = descriptionParts.join('\n');

  return result;
}