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
const LISTING_CONCURRENCY = 4;

export class EuroestatesScraper extends BaseScraper {
  readonly source = "euroestates";
  readonly timeoutMs = 600000;

  protected override readonly DETAIL_DELAY_MS = 300;

  private listingItems = new Map<string, ListingItem>();

  protected async collectListings(): Promise<Property[]> {
    const allItems: ListingItem[] = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const pages: number[] = [];
      for (let i = 0; i < LISTING_CONCURRENCY && page + i <= MAX_PAGES; i++) {
        pages.push(page + i);
      }

      const results = await Promise.all(
        pages.map(async (pageNumber) => {
          const url = `${LISTING_URL}${pageNumber}`;
          logger.info(
            `[${this.source}] Fetching listing page ${pageNumber}: ${url}`
          );

          try {
            const html = await this.fetchPage(url);
            return { page: pageNumber, items: parseEuroestatesListing(html) };
          } catch (error) {
            logger.warn(
              `[${this.source}] Error fetching listing page ${pageNumber}:`,
              error
            );
            return { page: pageNumber, items: [] as ListingItem[] };
          }
        })
      );

      let stop = false;
      for (const result of results) {
        if (result.items.length === 0) {
          logger.info(
            `[${this.source}] No items on page ${result.page}, stopping`
          );
          stop = true;
          break;
        }

        allItems.push(...result.items);
        logger.info(
          `[${this.source}] Page ${result.page}: ${result.items.length} items`
        );
      }
      if (stop) break;

      page += pages.length;
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
