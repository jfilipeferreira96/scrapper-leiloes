import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { parseLCPremiumListing, parseLCPremiumDetail } from "./lcpremium.parser.js";

const BASE_URL = "https://www.lcpremium.pt";
const MAX_PAGES = 10;

const AUCTION_TYPES = [
  "electronic-auctions",
  "live-auctions",
  "sealed-bid",
  "private-sales",
];

export class LCPremiumScraper {
  readonly source = "lcpremium";

  async scrape(): Promise<Property[]> {
    const allProperties: Property[] = [];

    for (const auctionType of AUCTION_TYPES) {
      try {
        const properties = await this.scrapeAuctionType(auctionType);
        allProperties.push(...properties);
      } catch (error) {
        console.error(`[${this.source}] Error scraping ${auctionType}:`, error);
      }
    }

    return allProperties;
  }

  private async scrapeAuctionType(auctionType: string): Promise<Property[]> {
    const allProperties: Property[] = [];
    let url: string | null = `${BASE_URL}/pt/${auctionType}`;
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;
      try {
        const html = await fetchPage(url);
        const { properties: baseProperties, nextUrl } = parseLCPremiumListing(html, auctionType);

        // Each listing may expand into multiple lots
        for (const base of baseProperties) {
          try {
            const enrichedProperties = await this.enrichProperty(base);
            allProperties.push(...enrichedProperties);
          } catch (error) {
            console.error(`[${this.source}] Error enriching ${base.url}:`, error);
            allProperties.push(base);
          }
        }

        url = nextUrl ? (nextUrl.startsWith("http") ? nextUrl : `${BASE_URL}${nextUrl}`) : null;
      } catch (error) {
        console.error(`[${this.source}] Error scraping ${auctionType} page ${pageCount}:`, error);
        break;
      }
    }

    return allProperties;
  }

  private async enrichProperty(base: Property): Promise<Property[]> {
    const html = await fetchPage(base.url);
    return parseLCPremiumDetail(html, base);
  }
}
