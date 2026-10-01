import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { fetchPage } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseVamgoListing,
  parseVamgoDetail,
  type ListingItem,
} from "./vamgo.parser.js";

// ?cat=1 lists all imoveis; the ?tipo=N sections are iterated as well and
// deduplicated, in case cat=1 ever stops covering every sale type
const LISTING_URL = "https://www.vamgo.pt/?cat=1&q=";
const TYPE_URLS = [
  "https://www.vamgo.pt/?tipo=1",
  "https://www.vamgo.pt/?tipo=2",
  "https://www.vamgo.pt/?tipo=6",
  "https://www.vamgo.pt/?tipo=7",
];

export class VamgoScraper extends BaseScraper {
  readonly source = "vamgo";

  private listingItems = new Map<string, ListingItem>();

  protected async collectListings(): Promise<Property[]> {
    const items = new Map<string, ListingItem>();

    for (const url of [LISTING_URL, ...TYPE_URLS]) {
      try {
        logger.info(`[${this.source}] Fetching ${url}`);
        const html = await fetchPage(url);
        const parsed = parseVamgoListing(html);
        for (const item of parsed) {
          if (!items.has(item.externalId)) {
            items.set(item.externalId, item);
          }
        }
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching ${url}:`, error);
      }
    }

    logger.info(`[${this.source}] Found ${items.size} properties in listings`);

    const properties: Property[] = [];
    for (const item of items.values()) {
      this.listingItems.set(item.externalId, item);
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

    try {
      const html = await fetchPage(base.url);
      const detail = parseVamgoDetail(html, listing);

      return {
        ...base,
        ...detail,
        price: detail.price ?? base.price,
        openingValue: listing.baseValue > 0 ? listing.baseValue : undefined,
        minSaleValue: listing.minValue > 0 ? listing.minValue : undefined,
        currentBid: listing.currentBid > 0 ? listing.currentBid : undefined,
        images: detail.images?.length ? detail.images : base.images,
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
    const price = item.currentBid > 0 ? item.currentBid : item.baseValue;

    return {
      source: "vamgo",
      externalId: item.externalId,
      title: item.title,
      description: [item.description, item.processInfo].filter(Boolean).join("\n\n"),
      price,
      openingValue: item.baseValue > 0 ? item.baseValue : undefined,
      minSaleValue: item.minValue > 0 ? item.minValue : undefined,
      currentBid: item.currentBid > 0 ? item.currentBid : undefined,
      location: "",
      url: item.url,
      images: item.image ? [item.image] : [],
      auctionType: item.auctionType,
      status: "active",
      publishedAt: new Date(),
    };
  }
}
