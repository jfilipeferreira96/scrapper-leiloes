import type { Property } from "../models/property.js";
import { logger } from "../utils/logger.js";
import { fetchPage, delay } from "../utils/http.js";

export interface Scraper {
  readonly source: string;
  scrape(): Promise<Property[]>;
}

export abstract class BaseScraper implements Scraper {
  abstract readonly source: string;

  protected readonly DETAIL_DELAY_MS = 1000;

  protected fetchPage = fetchPage;
  protected delay = delay;

  protected abstract collectListings(): Promise<Property[]>;
  protected abstract enrichDetail(base: Property): Promise<Property>;

  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape`);

    const listings = await this.collectListings();
    logger.info(`[${this.source}] ${listings.length} properties in listing`);

    const enriched: Property[] = [];
    for (const prop of listings) {
      try {
        await delay(this.DETAIL_DELAY_MS);
        const enrichedProp = await this.enrichDetail(prop);
        enriched.push(enrichedProp);
        logger.debug(`[${this.source}] Detail loaded: ${prop.source}-${prop.externalId}`);
      } catch (error) {
        logger.warn(`[${this.source}] Error enriching ${prop.url}:`, error);
        enriched.push(prop);
      }
    }

    logger.info(`[${this.source}] Scrape complete: ${enriched.length} properties`);
    return enriched;
  }
}
