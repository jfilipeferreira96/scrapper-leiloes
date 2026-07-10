import { BaseScraper } from "../base.scraper.js";
import type { Property } from "../../models/property.js";
import { fetchPage } from "../../utils/http.js";
import { parseOneFixListing, parseOneFixDetail } from "./onefix.parser.js";

const ONEFIX_URL = "https://www.onefix-leiloeiros.pt/tipo_verbas/1/Imoveis";

export class OneFixScraper extends BaseScraper {
  readonly source = "onefix";
  protected readonly DETAIL_DELAY_MS = 1000;

  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];
    let currentUrl: string | null = ONEFIX_URL;

    while (currentUrl) {
      try {
        const html = await fetchPage(currentUrl);
        const { properties, nextUrl } = parseOneFixListing(html);
        allProperties.push(...properties);
        currentUrl = nextUrl ? `https://www.onefix-leiloeiros.pt${nextUrl}` : null;
      } catch (error) {
        console.error(`[${this.source}] Error loading page ${currentUrl}:`, error);
        currentUrl = null;
      }
    }

    return allProperties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    return parseOneFixDetail(detailHtml, base);
  }
}
