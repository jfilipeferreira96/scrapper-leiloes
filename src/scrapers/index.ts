import { OneFixScraper } from "./onefix/onefix.scraper.js";
import { BidLeiloeiraScraper } from "./bidleiloeira/bidleiloeira.scraper.js";
import { LCPremiumScraper } from "./lcpremium/lcpremium.scraper.js";
import { LeilosocScraper } from "./leilosoc/leilosoc.scraper.js";
import { AvalibericaScraper } from "./avaliberica/avaliberica.scraper.js";
import { LeilostarScraper } from "./leilostar/leilostar.scraper.js";
import { InlexScraper } from "./inlex/inlex.scraper.js";
import { VLeiloesScraper } from "./vleiloes/vleiloes.scraper.js";
import { LeiloeiraDolenaScraper } from "./leiloeiradolena/leiloeiradolena.scraper.js";
import { SolventiumScraper } from "./solventium/solventium.scraper.js";
import { ExclusivagoraScraper } from "./exclusivagora/exclusivagora.scraper.js";
import { LeiloatriumScraper } from "./leiloatrium/leiloatrium.scraper.js";
import { CParaisoScraper } from "./cparaiso/cparaiso.scraper.js";
import { ViaserumosScraper } from "./viaserumos/viaserumos.scraper.js";
import { MaximovalorScraper } from "./maximovalor/maximovalor.scraper.js";
import { CaixaimobiliarioScraper } from "./caixaimobiliario/caixaimobiliario.scraper.js";
import { ImolorienteScraper } from "./imoloriente/imoloriente.scraper.js";
import { AleiloeiraforenseScraper } from "./aleiloeiraforense/aleiloeiraforense.scraper.js";
import { LeilosilScraper } from "./leilosil/leilosil.scraper.js";
import { CapitalScraper } from "./capital/capital.scraper.js";
import { EuroestatesScraper } from "./euroestates/euroestates.scraper.js";
import { VamgoScraper } from "./vamgo/vamgo.scraper.js";
import { LeilovalorScraper } from "./leilovalor/leilovalor.scraper.js";
import { EleiloesScraper } from "./eleiloes/eleiloes.scraper.js";
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
  solventium: new SolventiumScraper() as Scraper,
  exclusivagora: new ExclusivagoraScraper() as Scraper,
  leiloatrium: new LeiloatriumScraper() as Scraper,
  cparaiso: new CParaisoScraper() as Scraper,
  viaserumos: new ViaserumosScraper() as Scraper,
  maximovalor: new MaximovalorScraper() as Scraper,
  caixaimobiliario: new CaixaimobiliarioScraper() as Scraper,
  imoloriente: new ImolorienteScraper() as Scraper,
  aleiloeiraforense: new AleiloeiraforenseScraper() as Scraper,
  leilosil: new LeilosilScraper() as Scraper,
  capital: new CapitalScraper() as Scraper,
  euroestates: new EuroestatesScraper() as Scraper,
  vamgo: new VamgoScraper() as Scraper,
  leilovalor: new LeilovalorScraper() as Scraper,
  eleiloes: new EleiloesScraper() as Scraper,
};

export function getActiveScrapers(): Scraper[] {
  const active = config.activeScrapers.filter((s) => s.length > 0);

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