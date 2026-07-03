/**
 * Scraper Service.
 *
 * Runs active scrapers using the central registry.
 * Respects config.activeScrapers.
 */

import { getActiveScrapers } from "../scrapers/index.js";
import type { Property } from "../models/property.js";
import { logger } from "../utils/logger.js";

/**
 * Run all active scrapers (based on config.activeScrapers).
 *
 * @returns Array of all properties collected from active scrapers
 */
export async function runAllScrapers(): Promise<Property[]> {
  const scrapers = getActiveScrapers();
  const allProperties: Property[] = [];

  logger.info(`Starting ${scrapers.length} active scrapers`);

  for (const scraper of scrapers) {
    try {
      logger.info(`[scraper-service] Running ${scraper.source}...`);
      const props = await scraper.scrape();
      allProperties.push(...props);
      logger.info(`[scraper-service] ${scraper.source}: ${props.length} properties`);
    } catch (error) {
      logger.error(`[scraper-service] Error in ${scraper.source}:`, error);
    }
  }

  logger.info(`Total collected: ${allProperties.length} properties`);
  return allProperties;
}