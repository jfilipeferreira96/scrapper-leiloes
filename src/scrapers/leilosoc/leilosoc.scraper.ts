/**
 * Leilosoc Scraper.
 *
 * Handles property listings from leilosoc.com with pagination.
 * Returns properties from Portugal only.
 */

import type { Property } from "../../models/property.js";
import { fetchPage, delay } from "../../utils/http.js";
import { parseLeilosocListing, parseLeilosocDetail } from "./leilosoc.parser.js";

const BASE_URL = "https://leilosoc.com";
const CATEGORY_URL = `${BASE_URL}/category/5-imoveis`;
const MAX_PAGES = 50; // Safety limit

export class LeilosocScraper {
  readonly source = "leilosoc";

  async scrape(): Promise<Property[]> {
    const allProperties: Property[] = [];
    let url: string | null = `${CATEGORY_URL}?view=48&page=1`;
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;
      try {
        console.log(`[${this.source}] Scraping page ${pageCount}: ${url}`);
        const html = await fetchPage(url);
        const { properties: baseProperties, nextUrl } = parseLeilosocListing(html);

        console.log(`[${this.source}] Found ${baseProperties.length} properties on page ${pageCount}`);

        // Enrich each property with detail page data
        for (const base of baseProperties) {
          try {
            await delay(1000); // Delay between detail page requests
            const enrichedProperty = await this.enrichProperty(base);
            allProperties.push(enrichedProperty);
            console.log(`[${this.source}] Enriched: ${base.externalId} - ${base.title}`);
          } catch (error) {
            console.error(`[${this.source}] Error enriching ${base.url}:`, error);
            // Add base property even if enrichment fails
            allProperties.push(base);
          }
        }

        // Determine next URL
        if (nextUrl) {
          url = nextUrl.startsWith('http') ? nextUrl : `${BASE_URL}${nextUrl}`;
        } else {
          // Try to generate next page URL
          const currentPageMatch = url.match(/page=(\d+)/);
          if (currentPageMatch) {
            const currentPage = parseInt(currentPageMatch[1], 10);
            const nextPage = currentPage + 1;
            url = `${CATEGORY_URL}?view=48&page=${nextPage}`;
          } else {
            url = null;
          }
        }
      } catch (error) {
        console.error(`[${this.source}] Error scraping page ${pageCount}:`, error);
        break;
      }
    }

    console.log(`[${this.source}] Total properties scraped: ${allProperties.length}`);
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