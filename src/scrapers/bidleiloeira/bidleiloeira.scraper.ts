import axios from "axios";
import type { Scraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { isLocationOfInterest } from "../../config/locations.js";
import { parseBidLeiloeiraListing, parseBidLeiloeiraDetail } from "./bidleiloeira.parser.js";

const BASE_URL = "https://www.bidleiloeira.pt";
const DETAIL_DELAY_MS = 1000;

// 4 auction types to scrape
const AUCTION_TYPES = [
  "leiloes-electronicos",
  "negociacao-particular",
  "leiloes-presenciais",
  "carta-fechada"
];

export class BidLeiloeiraScraper implements Scraper {
  readonly source = "bidleiloeira";

  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape from ${BASE_URL}`);

    const allProperties: Property[] = [];

    // Level 1: Scraping listing (all 4 auction types)
    for (const auctionType of AUCTION_TYPES) {
      logger.debug(`[${this.source}] Scraping ${auctionType}...`);
      
      try {
        const url = `${BASE_URL}/${auctionType}`;
        const html = await this.fetchPage(url);
        const properties = parseBidLeiloeiraListing(html, auctionType);
        
        logger.debug(`[${this.source}] ${auctionType}: ${properties.length} properties`);
        allProperties.push(...properties);
      } catch (error) {
        logger.error(`[${this.source}] Error scraping ${auctionType}:`, error);
      }
    }

    logger.info(`[${this.source}] Listing total: ${allProperties.length} properties`);

    // Level 2: Filter by location (if enabled)
    let filtered = allProperties;
    if (config.filterByLocation) {
      filtered = allProperties.filter((p) => isLocationOfInterest(p.location));
      logger.info(`[${this.source}] After location filter: ${filtered.length} properties`);
    }

    // Level 3: Detail fetching (enrichment)
    const enriched: Property[] = [];
    for (const prop of filtered) {
      try {
        await this.delay(DETAIL_DELAY_MS);
        const detailHtml = await this.fetchPage(prop.url);
        const enrichedProp = parseBidLeiloeiraDetail(detailHtml, prop);
        enriched.push(enrichedProp);
        logger.debug(`[${this.source}] Detail loaded: ${prop.source}-${prop.externalId}`);
      } catch (error) {
        logger.warn(`[${this.source}] Error loading detail for ${prop.url}:`, error);
        // Keep the listing property even without detail
        enriched.push(prop);
      }
    }

    logger.info(`[${this.source}] Scrape complete: ${enriched.length} properties (with details)`);
    return enriched;
  }

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

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}