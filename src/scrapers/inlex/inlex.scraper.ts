import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { logger } from "../../utils/logger.js";
import {
  parseInlexListing,
  parseInlexDetail,
  type ListingItem,
} from "./inlex.parser.js";

const BASE_URL = "https://www.inlexleiloeira.pt";
const LISTING_PATH = "/tipo_verbas/1/Imoveis";

export class InlexScraper extends BaseScraper {
  readonly source = "inlex";

  private listingItems = new Map<string, ListingItem>();

  protected async collectListings(): Promise<Property[]> {
    const allItems: ListingItem[] = [];
    let totalPages = 1;

    const firstUrl = `${BASE_URL}${LISTING_PATH}`;
    logger.info(`[${this.source}] Fetching listing page 1: ${firstUrl}`);

    const firstHtml = await this.fetchPage(firstUrl);
    const { items: firstItems, totalPages: detected } =
      parseInlexListing(firstHtml);
    totalPages = detected;
    allItems.push(...firstItems);

    logger.info(
      `[${this.source}] Page 1: ${firstItems.length} items (total pages: ${totalPages})`
    );

    // Page 2+ uses a different URL pattern than page 1
    for (let page = 2; page <= totalPages; page++) {
      try {
        await this.delay(this.DETAIL_DELAY_MS);
        const pageUrl = `${BASE_URL}/verbas/0/all/${page}`;
        logger.info(
          `[${this.source}] Fetching listing page ${page}/${totalPages}: ${pageUrl}`
        );

        const html = await this.fetchPage(pageUrl);
        const { items } = parseInlexListing(html);

        if (items.length === 0) {
          logger.info(`[${this.source}] No more items on page ${page}, stopping`);
          break;
        }

        allItems.push(...items);
        logger.info(`[${this.source}] Page ${page}: ${items.length} items`);
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching listing page ${page}:`, error);
        break;
      }
    }

    const properties: Property[] = [];
    for (const item of allItems) {
      this.listingItems.set(item.id, item);
      properties.push(this.listingItemToProperty(item));
    }

    return properties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    const listing = this.listingItems.get(base.externalId);
    if (!listing) {
      logger.warn(`[${this.source}] No listing data for ${base.externalId}`);
      return base;
    }

    const html = await this.fetchPage(base.url);
    const enriched = parseInlexDetail(html, listing);

    return {
      ...base,
      ...enriched,
      source: base.source,
      externalId: base.externalId,
      url: base.url,
    };
  }

  private listingItemToProperty(item: ListingItem): Property {
    return {
      source: "inlex",
      externalId: item.id,
      title: item.title,
      price: 0,
      location: item.location,
      url: item.url,
      images: item.image ? [item.image] : [],
      auctionType: item.auctionType,
      status: "active",
      publishedAt: new Date(),
    };
  }
}
