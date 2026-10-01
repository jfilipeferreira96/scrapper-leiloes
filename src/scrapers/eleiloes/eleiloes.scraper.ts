import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { fetchPage, delay } from "../../utils/http.js";
import { CurlHelper } from "../../utils/curl.js";
import { PuppeteerHelper } from "../../utils/puppeteer.js";
import { logger } from "../../utils/logger.js";
import {
  parseEleiloesListing,
  parseEleiloesDetail,
  type ListingItem,
} from "./eleiloes.parser.js";

const LISTING_URL = "https://www.e-leiloes.pt/eventos?tipo=1";

type FetchStrategy = "axios" | "curl" | "puppeteer";

export class EleiloesScraper extends BaseScraper {
  readonly source = "eleiloes";

  // the site blocks plain HTTP clients, so the first successful method is
  // remembered and reused for every subsequent request
  private strategy: FetchStrategy | null = null;
  private browserPage: import("puppeteer").Page | null = null;

  protected async collectListings(): Promise<Property[]> {
    const html = await this.fetchHtml(LISTING_URL);

    const items = parseEleiloesListing(html);
    logger.info(`[${this.source}] Found ${items.length} properties in listing`);

    const properties: Property[] = items.map((item) => this.listingItemToProperty(item));
    return properties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    try {
      const html = await this.fetchHtml(base.url);
      const detail = parseEleiloesDetail(html, base);

      return {
        ...base,
        ...detail,
        source: base.source,
        externalId: base.externalId,
        url: base.url,
      };
    } catch (error) {
      logger.warn(`[${this.source}] Error enriching ${base.url}:`, error);
      return base;
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    if (this.strategy) {
      return await this.fetchWith(url, this.strategy);
    }

    // axios (BaseScraper fetchPage)
    try {
      const html = await this.axiosGet(url);
      this.strategy = "axios";
      logger.info(`[${this.source}] Using strategy: axios`);
      return html;
    } catch {
      logger.info(`[${this.source}] axios blocked, trying curl`);
    }

    // system curl binary (different TLS fingerprint)
    try {
      const html = CurlHelper.get(url);
      if (this.looksValid(html)) {
        this.strategy = "curl";
        logger.info(`[${this.source}] Using strategy: curl`);
        return html;
      }
      logger.info(`[${this.source}] curl response looks blocked`);
    } catch {
      logger.info(`[${this.source}] curl failed, trying puppeteer`);
    }

    this.strategy = "puppeteer";
    logger.info(`[${this.source}] Using strategy: puppeteer`);
    return await this.puppeteerGet(url);
  }

  private async fetchWith(url: string, strategy: FetchStrategy): Promise<string> {
    if (strategy === "axios") {
      return await this.axiosGet(url);
    }
    if (strategy === "curl") {
      return CurlHelper.get(url);
    }
    return await this.puppeteerGet(url);
  }

  private async axiosGet(url: string): Promise<string> {
    const html = await fetchPage(url);
    if (!this.looksValid(html)) {
      throw new Error("response looks blocked");
    }
    return html;
  }

  private async puppeteerGet(url: string): Promise<string> {
    if (!this.browserPage) {
      const browser = await PuppeteerHelper.launch();
      this.browserPage = await browser.newPage();
      await this.browserPage.setViewport({ width: 1920, height: 1080 });
    }

    const page = this.browserPage;
    await PuppeteerHelper.goto(page, url, undefined, 45000);
    await delay(2000);

    let content = await page.content();

    if (!this.looksValid(content)) {
      logger.info(`[${this.source}] challenge page detected, retrying after delay`);
      await delay(5000);
      await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
      await delay(2000);
      content = await page.content();
    }

    return content;
  }

  private looksValid(html: string): boolean {
    if (!html || html.length < 500) return false;
    const blocked = [
      "Just a moment",
      "challenge-platform",
      "Access Denied",
      "captcha-delivery",
      "cf-browser-verification",
    ];
    return !blocked.some((marker) => html.includes(marker));
  }

  private listingItemToProperty(item: ListingItem): Property {
    return {
      source: "eleiloes",
      externalId: item.externalId,
      title: item.title,
      price: 0,
      location: "",
      url: item.url,
      images: [],
      auctionType: "Leilão Eletrônico",
      status: "active",
      publishedAt: new Date(),
    };
  }
}
