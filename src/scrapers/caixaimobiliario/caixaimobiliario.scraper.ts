import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import {
  extractCaixaimobiliarioListings,
  parseCaixaimobiliarioDetail,
} from './caixaimobiliario.parser.js';

const BASE_URL = 'https://www.caixaimobiliario.pt';
const LISTING_URL =
  'https://www.caixaimobiliario.pt/comprar/imoveis-venda.jsp?op=comprar&pgnr=1&ofs=0&rsnr=&pgsz=-1&listing=completa&ordby=preco&dc=0&tptpl=0&pcmax=0&pcmin=-1&f=0&armin=0';

export class CaixaimobiliarioScraper extends BaseScraper {
  readonly source = 'caixaimobiliario';

  protected async collectListings(): Promise<Property[]> {
    const html = await this.fetchPage(LISTING_URL);
    const partials = extractCaixaimobiliarioListings(html);

    const properties: Property[] = [];
    for (const partial of partials) {
      const property: Property = {
        source: partial.source || 'caixaimobiliario',
        externalId: partial.externalId || '',
        title: partial.title || '',
        price: partial.price || 0,
        location: partial.location || '',
        url: partial.url || '',
        images: partial.images || [],
        auctionType: partial.auctionType || 'Venda Direta',
        description: partial.description,
        district: partial.district,
        municipality: partial.municipality,
        area: partial.area,
      };

      properties.push(property);
    }

    return properties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    if (!base.url) {
      return base;
    }

    try {
      const html = await this.fetchPage(base.url);
      const detail = parseCaixaimobiliarioDetail(html, BASE_URL);

      return {
        ...base,
        title: detail.title || base.title,
        price: detail.price || base.price,
        externalId: detail.externalId || base.externalId,
        description: detail.description || base.description,
        location: detail.location || base.location,
        municipality: detail.municipality || base.municipality,
        district: detail.district || base.district,
        images: detail.images || base.images,
        area: detail.area || base.area,
      };
    } catch (error) {
      return base;
    }
  }
}