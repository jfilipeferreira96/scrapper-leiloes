import { OneFixScraper } from "./onefix/onefix.scraper.js";
import { BidLeiloeiraScraper } from "./bidleiloeira/bidleiloeira.scraper.js";
import { LCPremiumScraper } from "./lcpremium/lcpremium.scraper.js";
import { LeilosocScraper } from "./leilosoc/leilosoc.scraper.js";
import { AvalibericaScraper } from "./avaliberica/avaliberica.scraper.js";
import { LeilostarScraper } from "./leilostar/leilostar.scraper.js";
import { InlexScraper } from "./inlex/inlex.scraper.js";
import { VLeiloesScraper } from "./vleiloes/vleiloes.scraper.js";
import { LeiloeiraDolenaScraper } from "./leiloeiradolena/leiloeiradolena.scraper.js";
import type { Scraper } from "./base.scraper.js";
import { config } from "../config/index.js";

export const SCRAPERS: Record<string, Scraper> = {
  onefix: new OneFixScraper(),
  bidleiloeira: new BidLeiloeiraScraper(),
  lcpremium: new LCPremiumScraper() as Scraper,
  leilosoc: new LeilosocScraper() as Scraper,
  avaliberica: new AvalibericaScraper() as Scraper,
  leilostar: new LeilostarScraper() as Scraper,
  inlex: new InlexScraper() as Scraper,
  vleiloes: new VLeiloesScraper() as Scraper,
  leiloeiradolena: new LeiloeiraDolenaScraper() as Scraper,
};

export function getActiveScrapers(): Scraper[] {
  const active = config.activeScrapers.filter((s) => s.length > 0);

  // If no scrapers specified, run all registered scrapers
  if (active.length === 0) {
    return Object.values(SCRAPERS);
  }

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