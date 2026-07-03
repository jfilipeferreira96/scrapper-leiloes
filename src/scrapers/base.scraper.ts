/**
 * Scraper interface.
 *
 * All scrapers must implement this interface.
 * The scrape() method returns an array of Property objects.
 */
export interface Scraper {
  /** Source name (e.g., "onefix", "lcpremium", "bidleiloeira") */
  readonly source: string;

  /** Main scrape method */
  scrape(): Promise<Property[]>;
}

/**
 * Abstract base class for all scrapers.
 *
 * Provides a uniform pipeline:
 *  1. collectListings() → Property[] (from listing pages)
 *  2. filterByLocation() → Property[] (if config.filterByLocation)
 *  3. enrichDetails() → Property[] (fetch detail pages)
 *
 * Each scraper implements the hooks:
 *  - source (abstract property)
 *  - collectListings()
 *  - enrichDetail(prop)
 *
 * Inherited utilities:
 *  - fetchPage(url)
 *  - delay(ms)
 */

import type { Property } from "../models/property.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { fetchPage, delay } from "../utils/http.js";
import { isLocationOfInterest } from "../config/locations.js";

export abstract class BaseScraper implements Scraper {
  /** Source name (e.g., "onefix", "lcpremium", "bidleiloeira") */
  abstract readonly source: string;

  /** Delay between detail page requests (default: 1000ms) */
  protected readonly DETAIL_DELAY_MS = 1000;

  /**
   * Main scrape method — template method pattern.
   * Follows uniform pipeline: listing → filter → enrich.
   */
  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape`);

    // Step 1: Collect listings
    const listings = await this.collectListings();
    logger.info(`[${this.source}] ${listings.length} properties in listing`);

    // Step 2: Filter by location (if enabled)
    let filtered = listings;
    if (config.filterByLocation) {
      filtered = listings.filter((p) => isLocationOfInterest(p.location));
      logger.info(`[${this.source}] ${filtered.length} properties in target locations`);
    }

    // Step 3: Enrich with detail pages
    const enriched: Property[] = [];
    for (const prop of filtered) {
      try {
        await delay(this.DETAIL_DELAY_MS);
        const enrichedProp = await this.enrichDetail(prop);
        enriched.push(enrichedProp);
        logger.debug(`[${this.source}] Detail loaded: ${prop.source}-${prop.externalId}`);
      } catch (error) {
        logger.warn(`[${this.source}] Error enriching ${prop.url}:`, error);
        // Keep listing property even if enrichment fails
        enriched.push(prop);
      }
    }

    logger.info(`[${this.source}] Scrape complete: ${enriched.length} complete properties`);
    return enriched;
  }

  /**
   * Hook: Collect all properties from listing pages.
   * Should return basic Property objects with url, title, location, etc.
   *
   * @returns Array of Property objects from listings
   */
  protected abstract collectListings(): Promise<Property[]>;

  /**
   * Hook: Enrich a single Property with detail page data.
   * Should fetch the detail page and add prices, images, coordinates, etc.
   *
   * @param base - Base Property from listing
   * @returns Enriched Property object
   */
  protected abstract enrichDetail(base: Property): Promise<Property>;

  /**
   * Utility: Fetch a page (inherited from utils/http).
   * Available for subclasses that need custom fetch logic.
   */
  protected fetchPage = fetchPage;

  /**
   * Utility: Delay helper (inherited from utils/http).
   * Available for subclasses that need custom delays.
   */
  protected delay = delay;
}