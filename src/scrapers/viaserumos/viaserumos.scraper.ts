import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { parseViaserumosListing, parseViaserumosDetail } from './viaserumos.parser.js';

const BASE_URL = 'https://viaserumos.pt';
const LISTING_URL = `${BASE_URL}/tipo-de-bem/imoveis/`;

export class ViaserumosScraper extends BaseScraper {
  readonly source = 'viaserumos';

  protected async collectListings(): Promise<Property[]> {
    const html = await this.fetchPage(LISTING_URL);
    return parseViaserumosListing(html);
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    if (!base.url) {
      return base;
    }

    const html = await this.fetchPage(base.url);
    const detail = parseViaserumosDetail(html, base.url);
    
    return {
      ...base,
      ...detail,
    };
  }
}