// Static listing page: all items on one page, no pagination.

import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage, delay } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseCparaisoListing,
  parseCparaisoDetail,
} from "./cparaiso.parser.js";

const BASE_URL = "https://cparaiso.pt";
const LISTING_URL = `${BASE_URL}/pt/auction/category/id/5`;

export class CParaisoScraper extends BaseScraper {
  readonly source = "cparaiso";

  protected async collectListings(): Promise<Property[]> {
    logger.info(`[${this.source}] Fetching listing page: ${LISTING_URL}`);
    
    const html = await fetchPage(LISTING_URL);
    const listings = parseCparaisoListing(html);
    
    logger.info(`[${this.source}] Found ${listings.length} properties in listing`);
    return listings;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseCparaisoDetail(detailHtml, base);
  }
}
