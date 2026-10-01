// AJAX-driven listing with server-side session pagination:
// POST filter form → first batch + session cookie, then GET repeatedly for subsequent batches.

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage, fetchPagePost, delay } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseLeiloeiraDolenaListing,
  parseLeiloeiraDolenaDetail,
} from "./leiloeiradolena.parser.js";

const BASE_URL = "https://www.leiloeiradolena.com";
const LIST_ENDPOINT = `${BASE_URL}/lista_leiloes`;

const FILTER_FORM: Record<string, string> = {
  _mydivform: "box_lista_leiloes",
  pesq_subfamilia: "",
  pesq_tipo_bem: "2", // Imóvel
  pesq_concelho: "",
};

const MAX_PAGES = 30;

export class LeiloeiraDolenaScraper extends BaseScraper {
  readonly source = "leiloeiradolena";

  private cookieStr = "";

  // Status ("Retirado") is only known from the detail page, so filter after enrichment
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

  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

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

  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseLeiloeiraDolenaDetail(detailHtml, base);
  }
}
