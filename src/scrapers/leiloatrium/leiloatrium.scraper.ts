import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { LeiloatriumParser, type WpProduct } from './leiloatrium.parser.js';
import { logger } from '../../utils/logger.js';
import { PuppeteerHelper } from '../../utils/puppeteer.js';
import { delay } from '../../utils/http.js';

/**
 * Scraper for leiloatrium.pt — a WordPress + WooCommerce site.
 *
 * The site is behind a WAF (SiteGround) that blocks requests based on:
 * - TLS fingerprint (JA3) - Node.js gets 403
 * - JavaScript challenges - requires real browser execution
 * - Browser fingerprinting - detects automation tools
 *
 * Strategy:
 * 1. Use Puppeteer with stealth plugin to bypass WAF
 * 2. Navigate to WordPress REST API endpoint
 * 3. Extract JSON data for all products
 * 4. Filter to only Imóvel (tipo_de_bem = 931)
 * 5. Parse the JSON to extract property data
 */
export class LeiloatriumScraper extends BaseScraper {
  source = 'leiloatrium';

  /** Term ID 931 = "Imóvel" in the tipo_de_bem taxonomy. */
  private readonly IMOVEL_TERM_ID = 931;
  private readonly REST_API_URL = 'https://leiloatrium.pt/wp-json/wp/v2/product';
  private readonly BATCH_SIZE = 100; // WordPress REST API max per_page
  private readonly DELAY_BETWEEN_REQUESTS = 2000; // 2s delay to be respectful

  /**
   * Collect all Imóvel products via Puppeteer with stealth plugin.
   */
  protected async collectListings(): Promise<Property[]> {
    const properties: Property[] = [];

    logger.info(`[leiloatrium] Launching Puppeteer with stealth plugin`);

    let browser;
    try {
      browser = await PuppeteerHelper.launch();
    } catch (err) {
      logger.error(`[leiloatrium] Failed to launch browser:`, err);
      return properties;
    }

    const page = await browser.newPage();

    // Set realistic viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      // Fetch products from REST API in batches
      let page_num = 1;
      let hasMore = true;

      while (hasMore) {
        const apiUrl = `${this.REST_API_URL}?tipo_de_bem=${this.IMOVEL_TERM_ID}&per_page=${this.BATCH_SIZE}&page=${page_num}&_embed=true`;

        logger.info(`[leiloatrium] Fetching page ${page_num} from REST API`);

        try {
          const products = await this.fetchJsonViaBrowser(page, apiUrl);

          if (products.length === 0) {
            hasMore = false;
            logger.info(`[leiloatrium] No more products at page ${page_num}`);
            break;
          }

          logger.info(`[leiloatrium] Page ${page_num}: ${products.length} products`);

          // Parse each product
          for (const product of products) {
            try {
              const property = LeiloatriumParser.parseProduct(product);
              if (property) {
                properties.push(property);
              }
            } catch (err) {
              logger.warn(`[leiloatrium] Failed to parse product:`, err);
            }
          }

          // If we got less than BATCH_SIZE, we've reached the end
          if (products.length < this.BATCH_SIZE) {
            hasMore = false;
          } else {
            page_num++;
            await delay(this.DELAY_BETWEEN_REQUESTS);
          }
        } catch (err) {
          logger.error(`[leiloatrium] Failed to fetch page ${page_num}:`, err);
          hasMore = false;
        }
      }

      logger.info(`[leiloatrium] Collected ${properties.length} properties`);
    } finally {
      await page.close();
    }

    return properties;
  }

  /**
   * Fetch JSON data from a URL using Puppeteer.
   * Navigates to the URL and extracts the JSON content from the page body.
   */
  private async fetchJsonViaBrowser(page: import('puppeteer').Page, url: string): Promise<WpProduct[]> {
    // Navigate to the JSON URL
    await PuppeteerHelper.goto(page, url, undefined, 30000);

    // Wait a bit for any WAF challenges to complete
    await delay(1000);

    // Get the page content (should be JSON)
    const content = await page.evaluate(() => {
      // Try to get text content from body (JSON responses)
      const body = document.body;
      if (body) {
        const text = body.textContent || '';
        // Check if it's a pre-formatted JSON (common in browsers)
        const pre = document.querySelector('pre');
        if (pre) {
          return pre.textContent || text;
        }
        return text;
      }
      return '';
    });

    if (!content || content.trim().length === 0) {
      logger.warn(`[leiloatrium] Empty response from ${url}`);
      return [];
    }

    // Check if we got a WAF challenge page instead of JSON
    if (content.includes('challenge') || content.includes('captcha') || content.includes('cloudflare')) {
      logger.warn(`[leiloatrium] WAF challenge detected at ${url}`);
      // Wait longer and try again
      await delay(5000);
      await page.reload({ waitUntil: 'networkidle2' });
      await delay(2000);

      const retryContent = await page.evaluate(() => {
        const pre = document.querySelector('pre');
        return pre?.textContent || document.body?.textContent || '';
      });

      if (!retryContent || retryContent.includes('challenge')) {
        logger.error(`[leiloatrium] WAF challenge persists after retry`);
        return [];
      }

      return this.parseJsonResponse(retryContent);
    }

    return this.parseJsonResponse(content);
  }

  /**
   * Parse JSON response, handling potential HTML wrapper.
   */
  private parseJsonResponse(content: string): WpProduct[] {
    try {
      const trimmed = content.trim();

      // Check if it's valid JSON
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      }

      // Try to extract JSON from HTML
      const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      logger.warn(`[leiloatrium] Response is not valid JSON`);
      return [];
    } catch (err) {
      logger.warn(`[leiloatrium] Failed to parse JSON:`, err);
      return [];
    }
  }

  /**
   * The REST API already returns full product data, so no separate detail fetch is needed.
   */
  protected async enrichDetail(property: Property): Promise<Property> {
    return property;
  }
}
