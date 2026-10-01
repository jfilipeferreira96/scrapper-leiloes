import type { Property } from "../../models/property.js";
import { fetchPage, fetchPageWithCookies, delay } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import {
  parseAvalibericaListing,
  parseAvalibericaDetail,
  countDetailPages,
  type SaleLink,
} from "./avaliberica.parser.js";

const BASE_URL = "https://www.avaliberica.pt";
const LISTING_PATH =
  "/results-page.php?search[mix]=&categorySells=6&search[sellTypes]=0&search[partnerCountries]=Portugal";
const DETAIL_DELAY_MS = 1500;

export class AvalibericaScraper {
  readonly source = "avaliberica";

  private cookieStr = "";

  async scrape(): Promise<Property[]> {
    const allSales = await this.collectAllSales();
    logger.info(`[${this.source}] Found ${allSales.length} sales across listing pages`);

    const properties: Property[] = [];

    for (let i = 0; i < allSales.length; i++) {
      const sale = allSales[i];
      logger.info(`[${this.source}] Processing sale ${i + 1}/${allSales.length}: id=${sale.id}`);

      try {
        await delay(DETAIL_DELAY_MS);
        const property = await this.enrichSale(sale);
        properties.push(property);
      } catch (error) {
        logger.warn(`[${this.source}] Error enriching sale ${sale.id}:`, error);
        properties.push(this.saleToProperty(sale));
      }
    }

    logger.info(`[${this.source}] Scrape complete: ${properties.length} properties`);
    return properties;
  }

  private async collectAllSales(): Promise<SaleLink[]> {
    const allSales: SaleLink[] = [];
    let totalPages = 1;

    // First page captures the PHPSESSID cookie
    const firstUrl = `${BASE_URL}${LISTING_PATH}&page=1`;
    logger.info(`[${this.source}] Fetching listing page 1: ${firstUrl}`);

    const { html: firstHtml, cookies } = await fetchPageWithCookies(firstUrl);
    this.cookieStr = cookies;
    logger.info(`[${this.source}] Session cookie captured: ${cookies.substring(0, 30)}...`);

    const { sales: firstSales, totalPages: detected } = parseAvalibericaListing(firstHtml);
    totalPages = detected;
    allSales.push(...firstSales);

    logger.info(`[${this.source}] Page 1: ${firstSales.length} sales (total pages: ${totalPages})`);

    for (let page = 2; page <= totalPages; page++) {
      try {
        await delay(DETAIL_DELAY_MS);
        const pageUrl = `${BASE_URL}${LISTING_PATH}&page=${page}`;
        logger.info(`[${this.source}] Fetching listing page ${page}/${totalPages}`);

        const html = await fetchPage(pageUrl, this.cookieStr);
        const { sales } = parseAvalibericaListing(html);

        if (sales.length === 0) {
          logger.info(`[${this.source}] No more sales on page ${page}, stopping`);
          break;
        }

        allSales.push(...sales);
        logger.info(`[${this.source}] Page ${page}: ${sales.length} sales`);
      } catch (error) {
        logger.warn(`[${this.source}] Error fetching listing page ${page}:`, error);
        break;
      }
    }

    return allSales;
  }

  private async enrichSale(sale: SaleLink): Promise<Property> {
    // 20 items per page to minimize HTTP requests
    const detailBase = `${BASE_URL}/auction-list.php?id=${sale.id}&session=${sale.session}&results=20`;

    const firstHtml = await fetchPage(`${detailBase}&page=1`, this.cookieStr);
    const enriched = parseAvalibericaDetail(firstHtml, sale);
    const detailPages = countDetailPages(firstHtml);

    if (detailPages > 1) {
      logger.info(`[${this.source}] Sale ${sale.id} has ${detailPages} detail pages`);

      for (let page = 2; page <= detailPages; page++) {
        try {
          await delay(DETAIL_DELAY_MS);
          const html = await fetchPage(`${detailBase}&page=${page}`, this.cookieStr);
          const pageData = parseAvalibericaDetail(html, sale);

          if (pageData.images) {
            enriched.images = [...new Set([...(enriched.images || []), ...pageData.images])];
          }
          if (pageData.description) {
            enriched.description = `${enriched.description || ""}\n\n${pageData.description}`;
          }
          if (pageData.price && enriched.price) {
            enriched.price += pageData.price;
          }
        } catch (error) {
          logger.warn(`[${this.source}] Error fetching detail page ${page} for sale ${sale.id}:`, error);
        }
      }
    }

    return this.saleToProperty(sale, enriched);
  }

  private saleToProperty(sale: SaleLink, enriched?: Partial<Property>): Property {
    return {
      source: "avaliberica",
      externalId: sale.id,
      title: sale.title,
      description: enriched?.description || "",
      price: enriched?.price || 0,
      openingValue: enriched?.openingValue,
      currentBid: enriched?.currentBid,
      location: sale.location || sale.saleLocation,
      url: sale.url,
      images: enriched?.images || (sale.image ? [sale.image] : []),
      latitude: enriched?.latitude,
      longitude: enriched?.longitude,
      status: enriched?.status || "active",
      auctionType: sale.auctionType,
      publishedAt: enriched?.publishedAt || new Date(),
    };
  }
}
