import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { type Browser, type Page, type LaunchOptions } from 'puppeteer';
import { logger } from './logger.js';
import { delay } from './http.js';

puppeteerExtra.use(StealthPlugin());

// Thin Puppeteer wrapper for sites whose WAFs block plain HTTP clients (launches with stealth plugin).
export class PuppeteerHelper {
  private static browser: Browser | null = null;

  // Singleton browser; the stealth plugin masks headless/automation signals for WAF bypass
  static async launch(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    const options: LaunchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    };

    this.browser = await puppeteerExtra.launch(options);
    logger.info('[PuppeteerHelper] Browser launched with stealth plugin');
    return this.browser;
  }

  static async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('[PuppeteerHelper] Browser closed');
    }
  }

  static async goto(
    page: Page,
    url: string,
    waitForSelector?: string,
    timeout: number = 30000
  ): Promise<void> {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout,
    });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout });
    }

    logger.debug(`[PuppeteerHelper] Navigated to ${url}`);
  }

  static async getText(page: Page, selector: string): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;
      return await element.evaluate((el: Element) => el.textContent?.trim() || null);
    } catch (err) {
      logger.warn(`[PuppeteerHelper] Failed to get text for ${selector}:`, err);
      return null;
    }
  }

  static async getHtml(page: Page, selector: string): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;
      return await element.evaluate((el: Element) => el.innerHTML || null);
    } catch (err) {
      logger.warn(`[PuppeteerHelper] Failed to get HTML for ${selector}:`, err);
      return null;
    }
  }

  static async getAttribute(
    page: Page,
    selector: string,
    attribute: string
  ): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;
      return await element.evaluate((el: Element, attr: string) => el.getAttribute(attr), attribute);
    } catch (err) {
      logger.warn(`[PuppeteerHelper] Failed to get attribute ${attribute} for ${selector}:`, err);
      return null;
    }
  }

  static async getTexts(page: Page, selector: string): Promise<string[]> {
    try {
      return await page.evaluate((sel: string) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map((el: Element) => el.textContent?.trim() || '');
      }, selector);
    } catch (err) {
      logger.warn(`[PuppeteerHelper] Failed to get texts for ${selector}:`, err);
      return [];
    }
  }

  static async getAttributes(
    page: Page,
    selector: string,
    attribute: string
  ): Promise<string[]> {
    try {
      return await page.evaluate((sel: string, attr: string) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map((el: Element) => el.getAttribute(attr) || '');
      }, selector, attribute);
    } catch (err) {
      logger.warn(`[PuppeteerHelper] Failed to get attributes ${attribute} for ${selector}:`, err);
      return [];
    }
  }

  static async evaluate<T>(page: Page, script: () => T): Promise<T> {
    return await page.evaluate(script);
  }

  static async waitForSelector(
    page: Page,
    selector: string,
    timeout: number = 30000
  ): Promise<void> {
    await page.waitForSelector(selector, { timeout });
  }

  // Scrolls to the bottom to trigger lazy loading
  static async scrollToBottom(page: Page, maxScrolls: number = 5): Promise<void> {
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await delay(1000);
    }
  }

  static async screenshot(page: Page, path: string): Promise<void> {
    await page.screenshot({ path, fullPage: true });
    logger.debug(`[PuppeteerHelper] Screenshot saved to ${path}`);
  }

  static async getCookies(page: Page): Promise<any[]> {
    return await page.cookies();
  }

  static async setCookies(page: Page, cookies: any[]): Promise<void> {
    await page.setCookie(...cookies);
  }

  static async retry<T>(
    page: Page,
    fn: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        logger.warn(`[PuppeteerHelper] Retry ${i + 1}/${maxRetries}`);
        await delay(retryDelay);
      }
    }
    throw new Error('Max retries exceeded');
  }
}