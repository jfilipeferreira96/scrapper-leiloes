/**
 * OneFix Scraper.
 *
 * Scrapes OneFix auction website (https://www.onefix-leiloeiros.pt).
 * Uses BaseScraper for uniform pipeline.
 */

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { parseOneFixListing, parseOneFixDetail } from "./onefix.parser.js";

const ONEFIX_URL = "https://www.onefix-leiloeiros.pt/tipo_verbas/1/Imoveis";

export class OneFixScraper extends BaseScraper {
  readonly source = "onefix";

  /** Delay between detail page requests */
  protected readonly DETAIL_DELAY_MS = 1000;

  /**
   * Collect all listings from OneFix (with pagination).
   * Follows "Próximo" button for pagination.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];
    let currentUrl: string | null = ONEFIX_URL;

    while (currentUrl) {
      try {
        const html = await fetchPage(currentUrl);
        const { properties, nextUrl } = parseOneFixListing(html);
        allProperties.push(...properties);

        if (nextUrl) {
          currentUrl = `https://www.onefix-leiloeiros.pt${nextUrl}`;
        } else {
          currentUrl = null;
        }
      } catch (error) {
        console.error(`[${this.source}] Error loading page ${currentUrl}:`, error);
        currentUrl = null;
      }
    }

    return allProperties;
  }

  /**
   * Enrich a single Property with detail page data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseOneFixDetail(detailHtml, base);
  }
}