/**
 * Imoloriente Scraper.
 *
 * Scrapes property auctions from www.imoloriente.pt.
 *
 * WordPress + WooCommerce site with auction plugin.
 * The site uses WAF protection that blocks Node.js TLS, so we use CurlHelper
 * (system curl binary) for all requests.
 *
 * Uses BaseScraper's template-method pipeline:
 *  1. collectListings() → fetch listing page, parse product cards
 *  2. enrichDetail()    → fetch detail page, merge enriched data
 */

import { BaseScraper } from '../base.scraper.js';
import type { Property } from '../../models/property.js';
import { logger } from '../../utils/logger.js';
import { delay } from '../../utils/http.js';
import { CurlHelper } from '../../utils/curl.js';
import {
  parseImolorienteListing,
  parseImolorienteDetail,
} from './imoloriente.parser.js';

const BASE_URL = 'https://www.imoloriente.pt';
const LISTING_URL = `${BASE_URL}/categoria-produto/imoveis/`;

export class ImolorienteScraper extends BaseScraper {
  readonly source = 'imoloriente';

  /**
   * Collect all listings from the imóveis category page.
   * WooCommerce paginates with /page/N/ URLs.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];
    const maxPages = 10;

    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? LISTING_URL : `${LISTING_URL}page/${page}/`;
      logger.info(`[${this.source}] Fetching listing page ${page}: ${url}`);

      try {
        const html = CurlHelper.get(url);
        const listings = parseImolorienteListing(html);

        if (listings.length === 0) {
          logger.info(`[${this.source}] No more listings on page ${page}, stopping`);
          break;
        }

        allProperties.push(...listings);
        logger.info(`[${this.source}] Page ${page}: ${listings.length} listings (total: ${allProperties.length})`);

        if (page < maxPages) {
          await delay(1500);
        }
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching page ${page}:`, error);
        break;
      }
    }

    return allProperties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    if (!base.url) return base;

    try {
      const html = CurlHelper.get(base.url);
      const detail = parseImolorienteDetail(html, base);

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
