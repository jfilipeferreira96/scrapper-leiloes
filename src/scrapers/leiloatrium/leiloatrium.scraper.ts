// SiteGround WAF blocks Node.js HTTP clients (JA3/TLS fingerprint), so the WP REST API
// is fetched through Puppeteer with the stealth plugin.

import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { LeiloatriumParser, type WpProduct } from './leiloatrium.parser.js';
import { logger } from '../../utils/logger.js';
import { PuppeteerHelper } from '../../utils/puppeteer.js';
import { delay } from '../../utils/http.js';

export class LeiloatriumScraper extends BaseScraper {
  source = 'leiloatrium';

  private readonly IMOVEL_TERM_ID = 931; // "Imóvel" in tipo_de_bem taxonomy
  private readonly REST_API_URL = 'https://leiloatrium.pt/wp-json/wp/v2/product';
  private readonly BATCH_SIZE = 100; // WP REST API max per_page
  private readonly DELAY_BETWEEN_REQUESTS = 2000;

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
    await page.setViewport({ width: 1920, height: 1080 });

    try {
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

  private async fetchJsonViaBrowser(page: import('puppeteer').Page, url: string): Promise<WpProduct[]> {
    await PuppeteerHelper.goto(page, url, undefined, 30000);

    // Wait for any WAF JS challenges to resolve
    await delay(1000);

    const content = await page.evaluate(() => {
      const body = document.body;
      if (body) {
        const text = body.textContent || '';
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

    // WAF challenge pages contain these keywords instead of JSON
    if (content.includes('challenge') || content.includes('captcha') || content.includes('cloudflare')) {
      logger.warn(`[leiloatrium] WAF challenge detected at ${url}`);
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

  private parseJsonResponse(content: string): WpProduct[] {
    try {
      const trimmed = content.trim();

      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      }

      // Response may be wrapped in HTML
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

  // REST API already returns full product data: no separate detail fetch needed
  protected async enrichDetail(property: Property): Promise<Property> {
    return property;
  }
}
