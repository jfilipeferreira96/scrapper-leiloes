/**
 * Scraper Registry.
 *
 * Central registry of all available scrapers.
 * New scrapers: add class here + update config.activeScrapers.
 */

import { OneFixScraper } from "./onefix/onefix.scraper.js";
import { BidLeiloeiraScraper } from "./bidleiloeira/bidleiloeira.scraper.js";
import { LCPremiumScraper } from "./lcpremium/lcpremium.scraper.js";
import type { Scraper } from "./base.scraper.js";
import { config } from "../config/index.js";

/**
 * All available scrapers mapped by source name.
 */
export const SCRAPERS: Record<string, Scraper> = {
  onefix: new OneFixScraper(),
  bidleiloeira: new BidLeiloeiraScraper(),
  lcpremium: new LCPremiumScraper() as Scraper,
};

/**
 * Get active scrapers based on config.
 *
 * @returns Array of enabled scrapers
 */
export function getActiveScrapers(): Scraper[] {
  const active = config.activeScrapers;
  const scrapers: Scraper[] = [];

  for (const source of active) {
    const scraper = SCRAPERS[source];
    if (scraper) {
      scrapers.push(scraper);
    } else {
      console.warn(`[scraper-registry] Unknown scraper: ${source}`);
    }
  }

  return scrapers;
}

/**
 * Get a scraper by source name.
 *
 * @param source - Source name (e.g., "onefix")
 * @returns Scraper instance, or undefined if not found
 */
export function getScraper(source: string): Scraper | undefined {
  return SCRAPERS[source];
}