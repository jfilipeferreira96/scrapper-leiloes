/**
 * Leilosoc Scraper.
 *
 * Handles property listings from leilosoc.com with pagination.
 * Returns properties from Portugal only (hard-coded filter in parser).
 */

import type { Property } from "../../models/property.js";
import { fetchPage, delay } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import { parseLeilosocListing, parseLeilosocDetail } from "./leilosoc.parser.js";

const BASE_URL = "https://leilosoc.com";
const CATEGORY_URL = `${BASE_URL}/category/5-imoveis`;
const ITEMS_PER_PAGE = 48;

export class LeilosocScraper {
  readonly source = "leilosoc";

  async scrape(): Promise<Property[]> {
    const allProperties: Property[] = [];
    let totalPages = 1;

    // First page: fetch and detect total pages
    const firstPageUrl = `${CATEGORY_URL}?view=${ITEMS_PER_PAGE}&page=1`;
    logger.info(`[${this.source}] Scraping page 1: ${firstPageUrl}`);
    
    const firstHtml = await fetchPage(firstPageUrl);
    const { properties: firstPageProperties, totalPages: detectedPages } = parseLeilosocListing(firstHtml);
    totalPages = detectedPages;
    
    logger.info(`[${this.source}] Page 1: ${firstPageProperties.length} Portugal properties (total pages: ${totalPages})`);
    
    // Enrich first page properties
    for (const base of firstPageProperties) {
      try {
        await delay(1000);
        const enrichedProperty = await this.enrichProperty(base);
        allProperties.push(enrichedProperty);
      } catch (error) {
        logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
        allProperties.push(base);
      }
    }

    // Remaining pages (2 to totalPages)
    for (let page = 2; page <= totalPages; page++) {
      try {
        const pageUrl = `${CATEGORY_URL}?view=${ITEMS_PER_PAGE}&page=${page}`;
        logger.info(`[${this.source}] Scraping page ${page}/${totalPages}: ${pageUrl}`);
        
        const html = await fetchPage(pageUrl);
        const { properties: pageProperties } = parseLeilosocListing(html);
        
        logger.info(`[${this.source}] Page ${page}: ${pageProperties.length} Portugal properties`);

        if (pageProperties.length === 0) {
          logger.info(`[${this.source}] No more properties, stopping`);
          break;
        }

        // Enrich page properties
        for (const base of pageProperties) {
          try {
            await delay(1000);
            const enrichedProperty = await this.enrichProperty(base);
            allProperties.push(enrichedProperty);
          } catch (error) {
            logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
            allProperties.push(base);
          }
        }
      } catch (error) {
        logger.warn(`[${this.source}] Error scraping page ${page}:`, error);
        break;
      }
    }

    logger.info(`[${this.source}] Scrape complete: ${allProperties.length} properties from ${totalPages} pages`);
    return allProperties;
  }

  /**
   * Enrich a Property with detail page data.
   */
  private async enrichProperty(base: Property): Promise<Property> {
    const html = await fetchPage(base.url);
    return parseLeilosocDetail(html, base);
  }
}
