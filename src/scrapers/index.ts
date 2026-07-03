import { OneFixScraper } from "./onefix/onefix.scraper.js";
import { BidLeiloeiraScraper } from "./bidleiloeira/bidleiloeira.scraper.js";
import { LCPremiumScraper } from "./lcpremium/lcpremium.scraper.js";
import { LeilosocScraper } from "./leilosoc/leilosoc.scraper.js";
import type { Scraper } from "./base.scraper.js";
import { config } from "../config/index.js";

export const SCRAPERS: Record<string, Scraper> = {
  //onefix: new OneFixScraper(),
  //bidleiloeira: new BidLeiloeiraScraper(),
  //lcpremium: new LCPremiumScraper() as Scraper,
  leilosoc: new LeilosocScraper() as Scraper,
};

export function getActiveScrapers(): Scraper[] {
  const active = config.activeScrapers;
  const scrapers: Scraper[] = [];

  for (const source of active) {
    const scraper = SCRAPERS[source];
    if (scraper) {
      scrapers.push(scraper);
    } else {
      console.warn(`[scraper-registry] Unknown scraper: ${source}`);
    }
  }

  return scrapers;
}

export function getScraper(source: string): Scraper | undefined {
  return SCRAPERS[source];
}