/**
 * BidLeiloeira Scraper.
 *
 * Scrapes 4 auction types: leiloes-electronicos, negociacao-particular,
 * leiloes-presenciais, carta-fechada.
 * Uses BaseScraper for uniform pipeline.
 */

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { parseBidLeiloeiraListing, parseBidLeiloeiraDetail } from "./bidleiloeira.parser.js";

const BASE_URL = "https://www.bidleiloeira.pt";

// 4 auction types to scrape
const AUCTION_TYPES = [
  "leiloes-electronicos",
  "negociacao-particular",
  "leiloes-presenciais",
  "carta-fechada",
];

export class BidLeiloeiraScraper extends BaseScraper {
  readonly source = "bidleiloeira";

  /**
   * Collect listings from all 4 auction types.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

    for (const auctionType of AUCTION_TYPES) {
      try {
        const url = `${BASE_URL}/${auctionType}`;
        const html = await fetchPage(url);
        const properties = parseBidLeiloeiraListing(html, auctionType);
        allProperties.push(...properties);
      } catch (error) {
        console.error(`[${this.source}] Error scraping ${auctionType}:`, error);
      }
    }

    return allProperties;
  }

  /**
   * Enrich a single Property with detail page data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseBidLeiloeiraDetail(detailHtml, base);
  }
}