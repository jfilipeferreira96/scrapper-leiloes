/**
 * Solventium Scraper.
 *
 * Scrapes 6 auction types via the ?tipo=N query parameter:
 *   tipo=2 → Leilão Electrónico
 *   tipo=1 → Leilão Presencial
 *   tipo=5 → Negociação Particular
 *   tipo=6 → Carta Fechada
 *   tipo=7 → Vendas Particulares
 *   tipo=10 → Brevemente
 *
 * Uses BaseScraper for the uniform pipeline (listing → filter → enrich).
 */

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseSolventiumListing,
  parseSolventiumDetail,
  AUCTION_TYPE_LABELS,
} from "./solventium.parser.js";

const BASE_URL = "https://www.solventium.pt";

/** Auction type params to scrape (?tipo=N). */
const AUCTION_TYPE_PARAMS = [2, 1, 5, 6, 7, 10];

/** Max number of listing pages to fetch per auction type. */
const MAX_PAGES = 20;

export class SolventiumScraper extends BaseScraper {
  readonly source = "solventium";

  /**
   * Collect listings from all auction types, handling pagination.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

    for (const tipo of AUCTION_TYPE_PARAMS) {
      const auctionType =
        AUCTION_TYPE_LABELS[tipo] || `Tipo ${tipo}`;
      try {
        const props = await this.collectType(tipo, auctionType);
        allProperties.push(...props);
        logger.info(
          `[${this.source}] ${auctionType}: ${props.length} listings`
        );
      } catch (error) {
        logger.error(
          `[${this.source}] Error scraping tipo=${tipo}:`,
          error
        );
      }
    }

    return allProperties;
  }

  /**
   * Collect a single auction type, iterating pages until empty.
   */
  private async collectType(
    tipo: number,
    auctionType: string
  ): Promise<Property[]> {
    const properties: Property[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        page === 1
          ? `${BASE_URL}/?tipo=${tipo}`
          : `${BASE_URL}/?tipo=${tipo}&page=${page}`;

      try {
        const html = await fetchPage(url);
        const pageProps = parseSolventiumListing(html, auctionType);

        if (pageProps.length === 0) {
          break; // No more results
        }

        properties.push(...pageProps);

        // If fewer than expected items returned, assume last page.
        if (pageProps.length < 5) {
          break;
        }
      } catch (error) {
        logger.warn(`[${this.source}] Error on page ${page} of tipo=${tipo}:`, error);
        break;
      }
    }

    return properties;
  }

  /**
   * Enrich a single Property with detail page data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseSolventiumDetail(detailHtml, base);
  }
}