import axios from "axios";
import type { Scraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { propertyKey } from "../../models/property.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { isLocationOfInterest } from "../../config/locations.js";
import { parseOneFixListing, parseOneFixDetail } from "./onefix.parser.js";

const ONEFIX_URL = "https://www.onefix-leiloeiros.pt/tipo_verbas/1/Imoveis";
const DETAIL_DELAY_MS = 1000; // 1 second between detail requests

export class OneFixScraper implements Scraper {
  readonly source = "onefix";

  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape from ${ONEFIX_URL}`);

    const allProperties: Property[] = [];
    let currentUrl: string | null = ONEFIX_URL;

    // Level 1: Listing with pagination (follow "Próximo" button)
    while (currentUrl) {
      try {
        const html = await this.fetchPage(currentUrl);
        const { properties, nextUrl } = parseOneFixListing(html);
        allProperties.push(...properties);

        if (nextUrl) {
          currentUrl = `https://www.onefix-leiloeiros.pt${nextUrl}`;
        } else {
          currentUrl = null;
        }
      } catch (error) {
        logger.error(`[${this.source}] Error loading page ${currentUrl}:`, error);
        currentUrl = null; // stop on error
      }
    }

    logger.info(`[${this.source}] ${allProperties.length} properties found in listing`);

    // Filter by location (if enabled)
    let filtered = allProperties;
    if (config.filterByLocation) {
      filtered = allProperties.filter((p) => isLocationOfInterest(p.location));
      logger.info(
        `[${this.source}] ${filtered.length} properties in target locations`
      );
    } else {
      logger.info(`[${this.source}] Location filtering disabled (bringing all properties)`);
    }

    // Level 2: Details (only for filtered properties)
    const enriched: Property[] = [];
    for (const prop of filtered) {
      try {
        await this.delay(DETAIL_DELAY_MS);
        const detailHtml = await this.fetchPage(prop.url);
        const enrichedProp = parseOneFixDetail(detailHtml, prop);
        enriched.push(enrichedProp);
        logger.debug(
          `[${this.source}] Detail loaded: ${propertyKey(prop.source, prop.externalId)}`
        );
      } catch (error) {
        logger.warn(`[${this.source}] Error loading detail for ${prop.url}:`, error);
        // Keep the listing property even without detail
        enriched.push(prop);
      }
    }

    logger.info(`[${this.source}] ${enriched.length} complete properties (with details)`);
    return enriched;
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
      },
      timeout: config.requestTimeout,
    });
    return response.data;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}