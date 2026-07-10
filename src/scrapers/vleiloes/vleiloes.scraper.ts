// Auction types via ?tipo=N: 2=Electrónico, 1=Presencial, 5=Negociação, 6=Carta Fechada

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseVLeiloesListing,
  parseVLeiloesDetail,
  AUCTION_TYPE_LABELS,
} from "./vleiloes.parser.js";

const BASE_URL = "https://www.vleiloes.com";
const AUCTION_TYPE_PARAMS = [2, 1, 5, 6];
const MAX_PAGES = 20;

export class VLeiloesScraper extends BaseScraper {
  readonly source = "vleiloes";

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
        const pageProps = parseVLeiloesListing(html, auctionType);

        if (pageProps.length === 0) {
          break;
        }

        properties.push(...pageProps);

        // Fewer than 5 items means we've hit the last page
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

  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseVLeiloesDetail(detailHtml, base);
  }
}
