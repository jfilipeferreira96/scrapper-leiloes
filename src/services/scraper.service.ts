import type { Scraper } from "../scrapers/base.scraper.js";
import type { Property } from "../models/property.js";
import { OneFixScraper } from "../scrapers/onefix/onefix.scraper.js";
import { logger } from "../utils/logger.js";

/**
 * Registry of available scrapers.
 * To add a new source, simply register it here.
 */
function getScrapers(): Scraper[] {
  return [new OneFixScraper()];
  // Phase 2: new LCPremiumScraper(), new BidScraper(), ...
}

/**
 * Runs all scrapers, normalizes and filters by location.
 * Note: Location filtering is already performed inside each scraper
 * (for OneFix, it happens after the listing and before fetching details).
 */
export async function runAllScrapers(): Promise<Property[]> {
  const scrapers = getScrapers();
  const allProperties: Property[] = [];

  for (const scraper of scrapers) {
    try {
      const props = await scraper.scrape();
      allProperties.push(...props);
    } catch (error) {
      logger.error(`Error in scraper ${scraper.source}:`, error);
    }
  }

  logger.info(
    `Total collected: ${allProperties.length} (already filtered by location)`
  );

  return allProperties;
}
