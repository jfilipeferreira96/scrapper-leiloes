/**
 * Leilostar Scraper
 *
 * Scrapes property auction data from leilostar.pt.
 *
 * Uses BaseScraper's template-method pipeline:
 *  1. collectListings() → fetch listing pages, parse property cards
 *  2. enrichDetail()    → fetch detail page, merge enriched data
 *
 * No session cookies needed — standard PHP site.
 */

import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { logger } from "../../utils/logger.js";
import {
  parseLeilostarListing,
  parseLeilostarDetail,
  type ListingItem,
} from "./leilostar.parser.js";

const BASE_URL = "https://www.leilostar.pt";
const LISTING_PATH = "/index.php?page=bem_list";

export class LeilostarScraper extends BaseScraper {
  readonly source = "leilostar";

  /** Listing items stored during collectListings for use in enrichDetail. */
  private listingItems = new Map<string, ListingItem>();

  /**
   * Fetch all listing pages and collect property cards.
   * Pagination via ?pn={page} parameter.
   */
  protected async collectListings(): Promise<Property[]> {
    const allItems: ListingItem[] = [];
    let totalPages = 1;

    // First page
    const firstUrl = `${BASE_URL}${LISTING_PATH}`;
    logger.info(`[${this.source}] Fetching listing page 1: ${firstUrl}`);

    const firstHtml = await this.fetchPage(firstUrl);
    const { items: firstItems, totalPages: detected } =
      parseLeilostarListing(firstHtml);
    totalPages = detected;
    allItems.push(...firstItems);

    logger.info(
      `[${this.source}] Page 1: ${firstItems.length} items (total pages: ${totalPages})`
    );

    // Remaining pages
    for (let page = 2; page <= totalPages; page++) {
      try {
        await this.delay(this.DETAIL_DELAY_MS);
        const pageUrl = `${BASE_URL}${LISTING_PATH}&pn=${page}`;
        logger.info(
          `[${this.source}] Fetching listing page ${page}/${totalPages}`
        );

        const html = await this.fetchPage(pageUrl);
        const { items } = parseLeilostarListing(html);

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

    // Store for enrichment phase + convert to Property[]
    const properties: Property[] = [];
    for (const item of allItems) {
      this.listingItems.set(item.id, item);
      properties.push(this.listingItemToProperty(item));
    }

    return properties;
  }

  /**
   * Fetch the detail page and merge enriched data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const listing = this.listingItems.get(base.externalId);
    if (!listing) {
      logger.warn(`[${this.source}] No listing data for ${base.externalId}`);
      return base;
    }

    const html = await this.fetchPage(base.url);
    const enriched = parseLeilostarDetail(html, listing);

    return {
      ...base,
      ...enriched,
      // Keep source/externalId/url from base (enriched doesn't have them)
      source: base.source,
      externalId: base.externalId,
      url: base.url,
    };
  }

  /** Convert a ListingItem to a basic Property object. */
  private listingItemToProperty(item: ListingItem): Property {
    return {
      source: "leilostar",
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
