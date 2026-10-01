/**
 * Leilosil Scraper.
 *
 * Scrapes property auctions from www.leilosil.pt.
 *
 * Custom auction platform where:
 *  - Listing page has basic data (title, image, end date) in HTML
 *  - Detail pages have title, description, images in HTML
 *  - Prices are loaded via JavaScript/AJAX (requires Puppeteer)
 *
 * Strategy:
 *  1. Fetch listing page with standard HTTP (curl/axios) - parse basic data
 *  2. For each property, use Puppeteer to load detail page and extract prices
 *
 * Uses BaseScraper's template-method pipeline:
 *  1. collectListings() → fetch listing page, parse auction items
 *  2. enrichDetail()    → use Puppeteer for JS-loaded prices
 */

import { BaseScraper } from '../base.scraper.js';
import type { Property } from '../../models/property.js';
import { fetchPage, delay } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { PuppeteerHelper } from '../../utils/puppeteer.js';
import {
  parseLeilosilListing,
  parseLeilosilDetail,
  parseLeilosilPrices,
} from './leilosil.parser.js';

const LISTING_URL = 'https://www.leilosil.pt/pt/auction/category/id/5';

export class LeilosilScraper extends BaseScraper {
  readonly source = 'leilosil';

  /**
   * Collect all listings from the imóveis category page.
   * The listing HTML contains basic data (title, image, end date).
   */
  protected async collectListings(): Promise<Property[]> {
    logger.info(`[${this.source}] Fetching listing page: ${LISTING_URL}`);

    const html = await fetchPage(LISTING_URL);
    const listings = parseLeilosilListing(html);

    logger.info(`[${this.source}] Found ${listings.length} properties in listing`);
    return listings;
  }

  // prices are JS-loaded, so the detail page needs Puppeteer
  protected async enrichDetail(base: Property): Promise<Property> {
    if (!base.url) return base;

    let browser = null;
    try {
      browser = await PuppeteerHelper.launch();
      const page = await browser.newPage();

      await PuppeteerHelper.goto(page, base.url, undefined, 30000);

      await page.waitForFunction(
        () => {
          const text = document.body.innerText || '';
          return text.includes('€') || text.includes('Valor') || text.includes('Abertura');
        },
        { timeout: 10000 }
      ).catch(() => {
        // price never showed up, continue anyway
      });

      await delay(2000);

      const renderedHtml = await page.content();
      await page.close();

      const detail = parseLeilosilDetail(renderedHtml, base);
      const prices = parseLeilosilPrices(renderedHtml);

      return {
        ...base,
        ...detail,
        ...prices,
        images: detail.images?.length ? detail.images : base.images,
      };
    } catch (error) {
      logger.warn(`[${this.source}] Puppeteer error for ${base.url}:`, error);

      try {
        const html = await fetchPage(base.url);
        const detail = parseLeilosilDetail(html, base);
        return {
          ...base,
          ...detail,
          images: detail.images?.length ? detail.images : base.images,
        };
      } catch (fallbackError) {
        logger.warn(`[${this.source}] Fallback also failed for ${base.url}:`, fallbackError);
        return base;
      }
    }
  }
}
