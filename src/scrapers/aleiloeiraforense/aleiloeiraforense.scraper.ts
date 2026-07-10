/**
 * Aleiloeira Forense Scraper.
 *
 * Scrapes property auctions from www.aleiloeiraforense.pt.
 *
 * Custom PHP site with a search page that lists all imóveis auctions.
 * The listing page already contains most data (price, description, process number).
 * Detail pages provide additional images and details.
 *
 * Uses BaseScraper's template-method pipeline:
 *  1. collectListings() → fetch search page, parse auction items
 *  2. enrichDetail()    → fetch detail page, merge enriched data
 */

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

  /**
   * Collect all listings from the imóveis search page.
   * The site shows all imóveis auctions on a single page.
   */
  protected async collectListings(): Promise<Property[]> {
    logger.info(`[${this.source}] Fetching listing page: ${LISTING_URL}`);

    const html = await fetchPage(LISTING_URL);
    const listings = parseAleiloeiraforenseListing(html);

    logger.info(`[${this.source}] Found ${listings.length} properties in listing`);
    return listings;
  }

  /**
   * Enrich a single Property with detail page data.
   */
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
