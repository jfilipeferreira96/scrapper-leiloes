import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { type Browser, type Page, type LaunchOptions } from 'puppeteer';
import { logger } from './logger.js';
import { delay } from './http.js';

// Register stealth plugin once
puppeteerExtra.use(StealthPlugin());

/**
 * Lightweight Puppeteer utility for scraping sites with WAF protection.
 *
 * This utility provides a simple interface to:
 * - Launch a headless browser (with stealth plugin for WAF bypass)
 * - Navigate to pages and wait for content
 * - Extract data from pages
 * - Clean up resources
 *
 * Usage:
 * ```typescript
 * const browser = await PuppeteerHelper.launch();
 * const page = await browser.newPage();
 * await PuppeteerHelper.goto(page, 'https://example.com');
 * const html = await page.content();
 * await browser.close();
 * ```
 */
export class PuppeteerHelper {
  private static browser: Browser | null = null;

  /**
   * Launch a Puppeteer browser instance with stealth plugin.
   * Reuses existing instance if available.
   *
   * The stealth plugin helps bypass WAF protections by:
   * - Masking automation indicators (navigator.webdriver)
   * - Spoofing browser plugins and languages
   * - Mocking Chrome runtime
   * - Evasion of headless detection
   */
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

  /**
   * Close the browser instance.
   */
  static async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('[PuppeteerHelper] Browser closed');
    }
  }

  /**
   * Navigate to a URL and wait for the page to load.
   *
   * @param page - Puppeteer page instance
   * @param url - URL to navigate to
   * @param waitForSelector - Optional CSS selector to wait for
   * @param timeout - Timeout in milliseconds (default: 30000)
   */
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

  /**
   * Extract text content from a page using a CSS selector.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @returns Text content or null if not found
   */
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

  /**
   * Extract HTML content from a page using a CSS selector.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @returns HTML content or null if not found
   */
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

  /**
   * Extract an attribute from an element using a CSS selector.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @param attribute - Attribute name
   * @returns Attribute value or null if not found
   */
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

  /**
   * Extract multiple elements' text content using a CSS selector.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @returns Array of text content
   */
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

  /**
   * Extract multiple elements' attributes using a CSS selector.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @param attribute - Attribute name
   * @returns Array of attribute values
   */
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

  /**
   * Execute JavaScript code in the page context.
   *
   * @param page - Puppeteer page instance
   * @param script - JavaScript function to execute
   * @param args - Arguments to pass to the function
   * @returns Result of the function execution
   */
  static async evaluate<T>(page: Page, script: () => T): Promise<T> {
    return await page.evaluate(script);
  }

  /**
   * Wait for a selector to appear in the page.
   *
   * @param page - Puppeteer page instance
   * @param selector - CSS selector
   * @param timeout - Timeout in milliseconds (default: 30000)
   */
  static async waitForSelector(
    page: Page,
    selector: string,
    timeout: number = 30000
  ): Promise<void> {
    await page.waitForSelector(selector, { timeout });
  }

  /**
   * Scroll to the bottom of the page to trigger lazy loading.
   *
   * @param page - Puppeteer page instance
   * @param maxScrolls - Maximum number of scroll attempts (default: 5)
   */
  static async scrollToBottom(page: Page, maxScrolls: number = 5): Promise<void> {
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await delay(1000);
    }
  }

  /**
   * Take a screenshot of the page (useful for debugging).
   *
   * @param page - Puppeteer page instance
   * @param path - Path to save the screenshot
   */
  static async screenshot(page: Page, path: string): Promise<void> {
    await page.screenshot({ path, fullPage: true });
    logger.debug(`[PuppeteerHelper] Screenshot saved to ${path}`);
  }

  /**
   * Get all cookies from the page.
   *
   * @param page - Puppeteer page instance
   * @returns Array of cookies
   */
  static async getCookies(page: Page): Promise<any[]> {
    return await page.cookies();
  }

  /**
   * Set cookies for the page.
   *
   * @param page - Puppeteer page instance
   * @param cookies - Array of cookies
   */
  static async setCookies(page: Page, cookies: any[]): Promise<void> {
    await page.setCookie(...cookies);
  }

  /**
   * Execute a function in the browser context with retry logic.
   *
   * @param page - Puppeteer page instance
   * @param fn - Function to execute
   * @param maxRetries - Maximum number of retries (default: 3)
   * @param retryDelay - Delay between retries in milliseconds (default: 1000)
   * @returns Result of the function execution
   */
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