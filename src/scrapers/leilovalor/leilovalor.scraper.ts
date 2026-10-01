import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { logger } from "../../utils/logger.js";
import {
  parseLeilovalorListing,
  parseLeilovalorDetail,
  type ListingItem,
} from "./leilovalor.parser.js";

const BASE_URL = "https://leilovalor.com";
const LISTING_PATH = "/index.php?page=bem_list&natureza=IMOVEL";

export class LeilovalorScraper extends BaseScraper {
  readonly source = "leilovalor";

  private listingItems = new Map<string, ListingItem>();

  protected async collectListings(): Promise<Property[]> {
    const allItems: ListingItem[] = [];
    let totalPages = 1;

    const firstUrl = `${BASE_URL}${LISTING_PATH}`;
    logger.info(`[${this.source}] Fetching listing page 1: ${firstUrl}`);

    const firstHtml = await this.fetchPage(firstUrl);
    const { items: firstItems, totalPages: detected } =
      parseLeilovalorListing(firstHtml);
    totalPages = detected;
    allItems.push(...firstItems);

    logger.info(
      `[${this.source}] Page 1: ${firstItems.length} items (total pages: ${totalPages})`
    );

    for (let page = 2; page <= totalPages; page++) {
      try {
        await this.delay(this.DETAIL_DELAY_MS);
        const pageUrl = `${BASE_URL}${LISTING_PATH}&pn=${page}`;
        logger.info(
          `[${this.source}] Fetching listing page ${page}/${totalPages}`
        );

        const html = await this.fetchPage(pageUrl);
        const { items } = parseLeilovalorListing(html);

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
    const enriched = parseLeilovalorDetail(html, listing);

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
      source: "leilovalor",
      externalId: item.id,
      title: item.title,
      price: item.minPrice,
      location: "",
      url: item.url,
      images: item.image ? [item.image] : [],
      auctionType: item.auctionType,
      status: "active",
      publishedAt: new Date(),
    };
  }
}
