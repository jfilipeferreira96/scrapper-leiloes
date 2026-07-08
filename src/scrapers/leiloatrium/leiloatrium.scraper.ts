import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { LeiloatriumParser, type WpProduct } from './leiloatrium.parser.js';
import { logger } from '../../utils/logger.js';
import { CurlHelper } from '../../utils/curl.js';
import * as cheerio from 'cheerio';

/**
 * Scraper for leiloatrium.pt — a WordPress + WooCommerce site.
 *
 * The site is behind a WAF that blocks requests based on TLS fingerprint (JA3).
 * Node.js's TLS implementation gets blocked (403), but the system's `curl`
 * binary uses a different TLS library (OpenSSL) that is NOT blocked.
 *
 * Strategy:
 * 1. Use `curl` (via CurlHelper) to fetch the sitemap and product pages
 * 2. Extract product IDs from the shortlink headers
 * 3. Fetch JSON from the WordPress REST API for each product
 * 4. Filter to only Imóvel (tipo_de_bem = 931)
 * 5. Parse the JSON to extract property data
 */
export class LeiloatriumScraper extends BaseScraper {
  source = 'leiloatrium';

  /** Term ID 931 = "Imóvel" in the tipo_de_bem taxonomy. */
  private readonly IMOVEL_TERM_ID = 931;
  private readonly SITEMAP_URL = 'https://leiloatrium.pt/wp-sitemap-posts-product-1.xml';

  /**
   * Collect all Imóvel products via curl (bypasses WAF TLS fingerprint blocking).
   */
  protected async collectListings(): Promise<Property[]> {
    const properties: Property[] = [];

    // Verify curl is available
    if (!CurlHelper.isAvailable()) {
      logger.error(`[leiloatrium] curl is not installed on this system`);
      return properties;
    }

    logger.info(`[leiloatrium] Fetching product sitemap via curl`);

    // Step 1: Fetch sitemap
    let productUrls: string[] = [];
    try {
      const sitemapXml = CurlHelper.get(this.SITEMAP_URL);
      productUrls = this.extractProductUrls(sitemapXml);
      logger.info(`[leiloatrium] Found ${productUrls.length} products in sitemap`);
    } catch (err) {
      logger.error(`[leiloatrium] Failed to fetch sitemap:`, err);
      return properties;
    }

    if (productUrls.length === 0) {
      logger.warn(`[leiloatrium] No products found in sitemap`);
      return properties;
    }

    // Step 2: For each product, fetch HTML to get ID, then fetch JSON
    for (const url of productUrls) {
      try {
        const property = await this.fetchProductData(url);
        if (property) {
          properties.push(property);
        }
      } catch (err) {
        logger.warn(`[leiloatrium] Failed to fetch product ${url}:`, err);
      }
    }

    logger.info(`[leiloatrium] Collected ${properties.length} properties`);
    return properties;
  }

  /**
   * Fetch product data by:
   * 1. Getting the product ID from the HTML page's shortlink
   * 2. Fetching the JSON from the REST API
   * 3. Filtering to only Imóvel (tipo_de_bem = 931)
   * 4. Parsing the JSON
   */
  private async fetchProductData(url: string): Promise<Property | null> {
    // Step 1: Fetch HTML with headers to get the shortlink
    const response = CurlHelper.getWithHeaders(url);

    if (response.status === 403) {
      logger.warn(`[leiloatrium] WAF blocked: ${url}`);
      return null;
    }

    if (response.status !== 200) {
      logger.warn(`[leiloatrium] HTTP ${response.status}: ${url}`);
      return null;
    }

    // Extract ID from shortlink header
    const linkHeader = response.headers['link'];
    let productId: number | null = null;

    if (linkHeader) {
      const shortlinkMatch = linkHeader.match(/<https:\/\/leiloatrium\.pt\/\?p=(\d+)>; rel="shortlink"/);
      if (shortlinkMatch) {
        productId = parseInt(shortlinkMatch[1], 10);
      }
    }

    // Fallback: extract from HTML
    if (!productId) {
      const $ = cheerio.load(response.body);
      const jsonLink = $('link[rel="alternate"][type="application/json"]').attr('href');
      if (jsonLink) {
        const match = jsonLink.match(/\/wp-json\/wp\/v2\/product\/(\d+)/);
        if (match) {
          productId = parseInt(match[1], 10);
        }
      }
    }

    if (!productId) {
      logger.warn(`[leiloatrium] Could not extract product ID from ${url}`);
      return null;
    }

    // Step 2: Fetch JSON from REST API
    const jsonUrl = `https://leiloatrium.pt/wp-json/wp/v2/product/${productId}?_embed=true`;
    const product = CurlHelper.getJson<WpProduct>(jsonUrl);

    // Step 3: Filter to only Imóvel (tipo_de_bem = 931)
    if (!product.tipo_de_bem?.includes(this.IMOVEL_TERM_ID)) {
      return null;
    }

    // Step 4: Parse the JSON
    return LeiloatriumParser.parseProduct(product);
  }

  /**
   * Extract product URLs from sitemap XML.
   */
  private extractProductUrls(xml: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(xml, { xmlMode: true });
    $('url loc').each((_, el) => {
      const url = $(el).text().trim();
      if (url.includes('/product/')) {
        urls.push(url);
      }
    });
    return urls;
  }

  /**
   * The REST API already returns full product data, so no separate detail fetch is needed.
   */
  protected async enrichDetail(property: Property): Promise<Property> {
    return property;
  }
}
