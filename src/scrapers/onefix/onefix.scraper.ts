import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { delay } from "../../utils/http.js";
import { CurlHelper } from "../../utils/curl.js";
import { logger } from "../../utils/logger.js";
import { parseOneFixListing, parseOneFixDetail } from "./onefix.parser.js";

const ONEFIX_URL = "https://www.onefix-leiloeiros.pt/tipo_verbas/1/Imoveis";
const MAX_PAGES = 10;

export class OneFixScraper extends BaseScraper {
  readonly source = "onefix";
  protected readonly DETAIL_DELAY_MS = 1000;

  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];
    let currentUrl: string | null = ONEFIX_URL;
    let pageCount = 0;

    while (currentUrl && pageCount < MAX_PAGES) {
      pageCount++;
      try {
        logger.info(`[${this.source}] Fetching listing page ${pageCount}: ${currentUrl}`);
        const html = CurlHelper.get(currentUrl);
        const { properties, nextUrl } = parseOneFixListing(html);
        allProperties.push(...properties);
        logger.info(`[${this.source}] Page ${pageCount}: ${properties.length} properties (total: ${allProperties.length})`);
        
        if (properties.length === 0) {
          logger.info(`[${this.source}] No properties found on page ${pageCount}, stopping pagination`);
          break;
        }
        
        currentUrl = nextUrl ? `https://www.onefix-leiloeiros.pt${nextUrl}` : null;
        
        if (currentUrl) {
          await delay(1500);
        }
      } catch (error) {
        logger.error(`[${this.source}] Error loading page ${currentUrl}:`, error);
        currentUrl = null;
      }
    }

    if (pageCount >= MAX_PAGES) {
      logger.warn(`[${this.source}] Reached maximum page limit (${MAX_PAGES}), stopping pagination`);
    }

    return allProperties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    try {
      logger.debug(`[${this.source}] Fetching detail page: ${base.url}`);
      const detailHtml = CurlHelper.get(base.url);
      return parseOneFixDetail(detailHtml, base);
    } catch (error) {
      logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
      return base;
    }
  }
}
