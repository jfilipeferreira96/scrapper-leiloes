import type { Property } from "../models/property.js";

/**
 * Contract that all scrapers must implement.
 * Regardless of the source, they always return Property[].
 */
export interface Scraper {
  /** Source identifier, e.g., "onefix" */
  readonly source: string;
  /** Executes scraping and returns the found properties */
  scrape(): Promise<Property[]>;
}