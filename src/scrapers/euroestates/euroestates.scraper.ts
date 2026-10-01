import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { logger } from "../../utils/logger.js";
import {
  parseEuroestatesListing,
  parseEuroestatesDetail,
  type ListingItem,
} from "./euroestates.parser.js";

const LISTING_URL = "https://euroestates.pt/realestate/list/";
const MAX_PAGES = 50;

export class EuroestatesScraper extends BaseScraper {
  readonly source = "euroestates";

  private listingItems = new Map<string, ListingItem>();

  protected async collectListings(): Promise<Property[]> {
    const allItems: ListingItem[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const url = `${LISTING_URL}${page}`;
        logger.info(`[${this.source}] Fetching listing page ${page}: ${url}`);

        const html = await this.fetchPage(url);
        const items = parseEuroestatesListing(html);

        if (items.length === 0) {
          logger.info(`[${this.source}] No items on page ${page}, stopping`);
          break;
        }

        allItems.push(...items);
        logger.info(`[${this.source}] Page ${page}: ${items.length} items`);

        await this.delay(this.DETAIL_DELAY_MS);
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching listing page ${page}:`, error);
        break;
      }
    }

    const properties: Property[] = [];
    for (const item of allItems) {
      this.listingItems.set(item.externalId, item);
      properties.push(this.listingItemToProperty(item));
    }

    logger.info(`[${this.source}] Collected ${properties.length} properties`);
    return properties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    const listing = this.listingItems.get(base.externalId);
    if (!listing) {
      logger.warn(`[${this.source}] No listing data for ${base.externalId}`);
      return base;
    }

    try {
      const html = await this.fetchPage(base.url);
      const detail = parseEuroestatesDetail(html, listing);

      return {
        ...base,
        ...detail,
        source: base.source,
        externalId: base.externalId,
        url: base.url,
      };
    } catch (error) {
      logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
      return base;
    }
  }

  private listingItemToProperty(item: ListingItem): Property {
    return {
      source: "euroestates",
      externalId: item.externalId,
      title: item.reference,
      price: item.price,
      location: item.location,
      url: item.url,
      images: item.image ? [item.image] : [],
      auctionType: item.usageType || "Venda",
      status: item.status,
      publishedAt: new Date(),
    };
  }
}
