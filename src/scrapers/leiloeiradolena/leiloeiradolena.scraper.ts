/**
 * Leiloeira do Lena Scraper.
 *
 * Scrapes property auctions from www.leiloeiradolena.com.
 *
 * The site uses an AJAX-driven listing with server-side session pagination:
 *  1. POST the filter form to `lista_leiloes` → first batch + session cookie
 *  2. GET `lista_leiloes/` repeatedly → subsequent batches (session tracks cursor)
 *  3. Stop when the response is empty or a lone "."
 *
 * Uses BaseScraper for the uniform pipeline (listing → filter → enrich).
 */

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage, fetchPagePost, delay } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseLeiloeiraDolenaListing,
  parseLeiloeiraDolenaDetail,
} from "./leiloeiradolena.parser.js";

const BASE_URL = "https://www.leiloeiradolena.com";

/** Endpoint that returns listing batches (POST for first, GET for the rest). */
const LIST_ENDPOINT = `${BASE_URL}/lista_leiloes`;

/**
 * Form fields sent on the initial POST.
 * `pesq_tipo_bem=2` filters to "Imóvel" (real estate). The site also exposes
 * other types (Veículos, Herança, etc.) but we focus on imóveis as requested.
 */
const FILTER_FORM: Record<string, string> = {
  _mydivform: "box_lista_leiloes",
  pesq_subfamilia: "",
  pesq_tipo_bem: "2", // Imóvel
  pesq_concelho: "",
};

/** Safety cap on the number of pagination GETs. */
const MAX_PAGES = 30;

export class LeiloeiraDolenaScraper extends BaseScraper {
  readonly source = "leiloeiradolena";

  /** Session cookie captured from the initial POST, reused for pagination GETs. */
  private cookieStr = "";

  /**
   * Override scrape() to filter out withdrawn ("Retirado") properties
   * after enrichment, since status is only known from the detail page.
   */
  async scrape(): Promise<Property[]> {
    const results = await super.scrape();
    const active = results.filter(
      (p) => p.status?.toLowerCase() !== "retirado"
    );
    if (results.length !== active.length) {
      logger.info(
        `[${this.source}] Filtered out ${results.length - active.length} withdrawn ("Retirado") properties`
      );
    }
    return active;
  }

  /**
   * Collect all listings via session-based pagination.
   *
   * 1. POST the filter form → first batch + capture session cookie.
   * 2. GET the endpoint repeatedly → subsequent batches.
   * 3. Stop on empty / "." response.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

    // --- Phase 1: POST filter form (first batch + session) ---
    logger.info(`[${this.source}] POSTing filter form to ${LIST_ENDPOINT}`);
    let html: string;
    try {
      const { html: postHtml, cookies } = await fetchPagePost(LIST_ENDPOINT, FILTER_FORM);
      this.cookieStr = cookies;
      html = postHtml;
    } catch (error) {
      logger.error(`[${this.source}] Error on initial POST:`, error);
      return allProperties;
    }

    let batch = parseLeiloeiraDolenaListing(html);
    allProperties.push(...batch);
    logger.info(`[${this.source}] Batch 1: ${batch.length} listings`);

    // --- Phase 2: GET subsequent batches ---
    for (let page = 2; page <= MAX_PAGES; page++) {
      try {
        await delay(800);
        const pageHtml = await fetchPage(`${LIST_ENDPOINT}/`, this.cookieStr);
        batch = parseLeiloeiraDolenaListing(pageHtml);

        if (batch.length === 0) {
          logger.info(`[${this.source}] No more listings at page ${page}, stopping`);
          break;
        }

        allProperties.push(...batch);
        logger.info(`[${this.source}] Batch ${page}: ${batch.length} listings (total: ${allProperties.length})`);
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching batch ${page}:`, error);
        break;
      }
    }

    return allProperties;
  }

  /**
   * Enrich a single Property with detail page data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseLeiloeiraDolenaDetail(detailHtml, base);
  }
}
