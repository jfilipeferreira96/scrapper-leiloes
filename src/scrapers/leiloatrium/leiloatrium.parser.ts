import * as cheerio from 'cheerio';
import { Property } from '../../models/property.js';
import { parsePrice } from '../../utils/parser.js';

/** Raw product object from the WordPress REST API. */
export interface WpProduct {
  id: number;
  date: string;
  modified: string;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  featured_media: number;
  class_list: string[];
  tipo_de_bem: number[];
  tipo_de_leilao: number[];
  distrito: number[];
  _embedded?: {
    'wp:featuredmedia'?: Array<{
      source_url: string;
      alt_text: string;
      media_details?: { sizes?: Record<string, { source_url: string }> };
    }>;
  };
}

export class LeiloatriumParser {
  /**
   * Parse a single WordPress REST API product into a Property.
   *
   * Extracts:
   *  - externalId from product id
   *  - title from title.rendered
   *  - description / prices / dates from content.rendered
   *  - auctionType, district from class_list (e.g. "distrito-coimbra")
   *  - images from embedded featured media
   */
  static parseProduct(product: WpProduct): Property {
    const $ = cheerio.load(`<div>${product.content.rendered}</div>`);

    // --- Prices -----------------------------------------------------------
    // "Valor Mínimo de Venda: 25.500,00€"
    // "Valor Base de Venda: 30.000,00€"
    let minSaleValue: number | undefined;
    let openingValue: number | undefined;
    $('p, li').each((_, el) => {
      const text = $(el).text().trim();
      const minMatch = text.match(/Valor M[íi]nimo de Venda:?\s*([\d.,]+)\s*€?/i);
      const baseMatch = text.match(/Valor Base de Venda:?\s*([\d.,]+)\s*€?/i);
      if (minMatch && minSaleValue === undefined) {
        minSaleValue = parsePrice(minMatch[1]);
      }
      if (baseMatch && openingValue === undefined) {
        openingValue = parsePrice(baseMatch[1]);
      }
    });

    // --- Dates ------------------------------------------------------------
    // "Data de início: 19 de junho de 2026 às 16:00H"
    // "Data de término: 17 de julho de 2026 às 14:00H"
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      const startMatch = text.match(/Data de in[íi]cio:?\s*(.+)/i);
      const endMatch = text.match(/Data de t[ée]rmino:?\s*(.+)/i);
      if (startMatch) {
        startDate = parsePortugueseDate(startMatch[1]);
      }
      if (endMatch) {
        endDate = parsePortugueseDate(endMatch[1]);
      }
    });

    // --- Status -----------------------------------------------------------
    let status = 'unknown';
    if (endDate) {
      status = endDate.getTime() > Date.now() ? 'open' : 'closed';
    }

    // --- Taxonomy from class_list ----------------------------------------
    // e.g. "tipo_de_leilao-negociacao-particular", "distrito-coimbra"
    let auctionType: string | undefined;
    let district: string | undefined;
    for (const cls of product.class_list || []) {
      if (cls.startsWith('tipo_de_leilao-')) {
        auctionType = humanizeSlug(cls.substring('tipo_de_leilao-'.length));
      } else if (cls.startsWith('distrito-')) {
        district = humanizeSlug(cls.substring('distrito-'.length));
      }
    }

    // --- Process number from excerpt -------------------------------------
    const excerptText = cheerio.load(product.excerpt.rendered).text().trim();

    // --- Images from embedded featured media -----------------------------
    const images: string[] = [];
    const featuredMedia = product._embedded?.['wp:featuredmedia']?.[0];
    if (featuredMedia?.source_url) {
      images.push(featuredMedia.source_url);
    }

    // --- Description (strip prices/dates, keep the rest) -----------------
    const description = cheerio.load(product.content.rendered).text().trim();

    // --- Clean title ------------------------------------------------------
    const title = cheerio.load(product.title.rendered).text().trim();

    return {
      source: 'leiloatrium',
      externalId: String(product.id),
      title,
      location: district || '',
      district,
      url: product.link,
      images,
      price: openingValue || minSaleValue || 0,
      openingValue,
      minSaleValue,
      description,
      auctionType,
      status,
      publishedAt: new Date(product.date),
    };
  }
}

/**
 * Convert a slug like "negociacao-particular" into "Negociação Particular".
 */
function humanizeSlug(slug: string): string {
  const map: Record<string, string> = {
    negociacao: 'Negociação',
    particular: 'Particular',
    leilao: 'Leilão',
    eletronico: 'Eletrónico',
    presencial: 'Presencial',
  };
  return slug
    .split('-')
    .map((word) => map[word] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Parse a Portuguese date string like "17 de julho de 2026 às 14:00H".
 */
function parsePortugueseDate(text: string): Date | undefined {
  const months: Record<string, number> = {
    janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };
  // "17 de julho de 2026 às 14:00H"
  const m = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})\s+[àa]s?\s+(\d{1,2}):(\d{2})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = months[m[2].toLowerCase()] ?? 0;
    const year = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);
    return new Date(year, month, day, hour, minute);
  }
  // Fallback: just the date part
  const m2 = text.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const month = months[m2[2].toLowerCase()] ?? 0;
    const year = parseInt(m2[3], 10);
    return new Date(year, month, day);
  }
  return undefined;
}
