// Custom PHP site: the search page lists all imoveis auctions with most data
// already present (price, description, process number); detail pages add images.

import { BaseScraper } from '../base.scraper.js';
import type { Property } from '../../models/property.js';
import { fetchPage } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import {
  parseAleiloeiraforenseListing,
  parseAleiloeiraforenseDetail,
} from './aleiloeiraforense.parser.js';

const LISTING_URL = 'https://www.aleiloeiraforense.pt/?chkimoveis=I&selectdistrito=0&q=';

export class AleiloeiraforenseScraper extends BaseScraper {
  readonly source = 'aleiloeiraforense';

  protected async collectListings(): Promise<Property[]> {
    logger.info(`[${this.source}] Fetching listing page: ${LISTING_URL}`);

    const html = await fetchPage(LISTING_URL);
    const listings = parseAleiloeiraforenseListing(html);

    logger.info(`[${this.source}] Found ${listings.length} properties in listing`);
    return listings;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    if (!base.url) return base;

    try {
      const html = await fetchPage(base.url);
      const detail = parseAleiloeiraforenseDetail(html, base);

      return {
        ...base,
        ...detail,
        images: detail.images?.length ? detail.images : base.images,
      };
    } catch (error) {
      logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
      return base;
    }
  }
}
