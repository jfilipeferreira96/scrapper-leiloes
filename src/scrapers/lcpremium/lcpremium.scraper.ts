/**
 * LC Premium Scraper
 *
 * Scrapes LC Premium auction website (https://www.lcpremium.pt).
 * Handles 4 auction types: electronic-auctions, live-auctions, sealed-bid, private-sales.
 *
 * Strategy:
 * 1. Iterate over 4 auction types
 * 2. For each type: pagination loop on listing pages
 * 3. Filter by location (if FILTER_BY_LOCATION=true)
 * 4. For each filtered property: GET detail page and enrich
 * 5. Return Property[]
 */

import axios from "axios";
import type { Scraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { isLocationOfInterest } from "../../config/locations.js";
import { parseLCPremiumListing, parseLCPremiumDetail } from "./lcpremium.parser.js";

const BASE_URL = "https://www.lcpremium.pt";
const DETAIL_DELAY_MS = 1000; // 1 second between detail requests
const MAX_PAGES = 10; // Safety limit per auction type

// 4 auction types to scrape
const AUCTION_TYPES = [
  "electronic-auctions",
  "live-auctions",
  "sealed-bid",
  "private-sales",
];

/**
 * LC Premium Scraper implementation
 */
export class LCPremiumScraper implements Scraper {
  readonly source = "lcpremium";

  /**
   * Main scrape method
   *
   * @returns Array of Property objects
   */
  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape from ${BASE_URL}`);

    const allProperties: Property[] = [];

    // Iterate over all auction types
    for (const auctionType of AUCTION_TYPES) {
      logger.info(`[${this.source}] Scraping ${auctionType}...`);

      try {
        const properties = await this.scrapeAuctionType(auctionType);
        allProperties.push(...properties);
        logger.info(`[${this.source}] ${auctionType}: ${properties.length} properties`);
      } catch (error) {
        logger.error(`[${this.source}] Error scraping ${auctionType}:`, error);
      }
    }

    logger.info(`[${this.source}] Total properties found: ${allProperties.length}`);
    return allProperties;
  }

  /**
   * Scrape a specific auction type with pagination
   *
   * @param auctionType - Auction type (electronic-auctions, live-auctions, sealed-bid, private-sales)
   * @returns Array of Property objects
   */
  private async scrapeAuctionType(auctionType: string): Promise<Property[]> {
    const allProperties: Property[] = [];
    let url: string | null = `${BASE_URL}/pt/${auctionType}`;
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;

      try {
        const html = await this.fetchPage(url);
        const { properties: baseProperties, nextUrl } = parseLCPremiumListing(html, auctionType);

        logger.debug(`[${this.source}] ${auctionType} page ${pageCount}: ${baseProperties.length} properties`);

        // Filter by location and enrich with detail page data
        for (const base of baseProperties) {
          // Location filter (only if enabled in config)
          if (config.filterByLocation) {
            const isLocationMatch = isLocationOfInterest(base.location);
            if (!isLocationMatch) {
              continue;
            }
          }

          // Enrich with detail page data
          try {
            await this.delay(DETAIL_DELAY_MS);
            const enrichedProperties = await this.enrichProperty(base);
            allProperties.push(...enrichedProperties);
          } catch (error) {
            logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
            // Add base property even if enrichment fails
            allProperties.push(base);
          }
        }

        // Move to next page
        url = nextUrl ? (nextUrl.startsWith("http") ? nextUrl : `${BASE_URL}${nextUrl}`) : null;

      } catch (error) {
        logger.error(`[${this.source}] Error scraping ${auctionType} page ${pageCount}:`, error);
        break;
      }
    }

    return allProperties;
  }

  /**
   * Enrich a Property object with data from detail page
   *
   * @param base - Base Property from listing page
   * @returns Array of enriched Property objects (one per lot)
   */
  private async enrichProperty(base: Property): Promise<Property[]> {
    const html = await this.fetchPage(base.url);
    const enrichedProperties = parseLCPremiumDetail(html, base);

    logger.debug(`[${this.source}] Detail loaded: ${base.source}-${base.externalId} (${enrichedProperties.length} lots)`);

    return enrichedProperties;
  }

  /**
   * Fetch a page and return its HTML content
   *
   * @param url - URL to fetch
   * @returns Raw HTML string
   */
  private async fetchPage(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
      },
      timeout: config.requestTimeout,
    });
    return response.data;
  }

  /**
   * Delay helper to avoid rate limiting
   *
   * @param ms - Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
