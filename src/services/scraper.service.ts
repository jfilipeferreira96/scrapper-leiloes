import { getActiveScrapers } from "../scrapers/index.js";
import type { Property } from "../models/property.js";
import type { Scraper } from "../scrapers/base.scraper.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

interface ScraperFailure {
  source: string;
  reason: string;
}

export interface ScrapeRun {
  properties: Property[];
  succeededSources: Set<string>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Scraper "${label}" exceeded timeout of ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function runAllScrapers(): Promise<ScrapeRun> {
  const scrapers = getActiveScrapers();
  const properties: Property[] = [];
  const succeededSources = new Set<string>();
  const failures: ScraperFailure[] = [];

  logger.info(`Starting ${scrapers.length} active scrapers`);

  for (const scraper of scrapers) {
    const startedAt = Date.now();
    try {
      logger.info(`[scraper-service] Running ${scraper.source}...`);
      const props = await withTimeout(
        scraper.scrape(),
        config.scraperTimeoutMs,
        scraper.source,
      );
      properties.push(...props);
      succeededSources.add(scraper.source);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      logger.info(`[scraper-service] ${scraper.source}: ${props.length} properties (${elapsed}s)`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      logger.error(`[scraper-service] ${scraper.source} failed after ${elapsed}s: ${reason}`);
      failures.push({ source: scraper.source, reason });
    }
  }

  if (failures.length > 0) {
    logger.error(`[scraper-service] ${failures.length} scraper(s) failed:`);
    for (const failure of failures) {
      logger.error(`[scraper-service]   - ${failure.source}: ${failure.reason}`);
    }
  }

  logger.info(`Total collected: ${properties.length} properties`);
  return { properties, succeededSources };
}
