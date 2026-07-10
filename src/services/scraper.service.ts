/**
 * Scraper Service.
 *
 * Runs active scrapers using the central registry.
 * Respects config.activeScrapers.
 *
 * Each scraper is wrapped in a per-scraper timeout
 * (config.scraperTimeoutMs, default 5 minutes). If a scraper exceeds the
 * limit it is skipped and the pipeline moves on to the next one. All
 * failures (timeouts and errors) are aggregated and logged as a
 * consolidated summary at the end of the run.
 */

import { getActiveScrapers } from "../scrapers/index.js";
import type { Property } from "../models/property.js";
import type { Scraper } from "../scrapers/base.scraper.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** A scraper that failed, either by timeout or by throwing an error. */
interface ScraperFailure {
  source: string;
  reason: string;
}

/**
 * Run a promise with a timeout. If the promise does not settle within
 * `timeoutMs`, it is rejected with a timeout error.
 *
 * The timer is cleared via `.finally()` to avoid keeping the event loop
 * alive after the promise settles.
 *
 * @param promise - The promise to race against the timer
 * @param timeoutMs - Maximum allowed duration in milliseconds
 * @param label - Human-readable label used in the timeout error message
 */
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

/**
 * Run all active scrapers (based on config.activeScrapers).
 *
 * Each scraper is given at most `config.scraperTimeoutMs` to complete. A
 * scraper that times out or throws is skipped, and its failure is recorded
 * for the end-of-run summary.
 *
 * @returns Array of all properties collected from active scrapers
 */
export async function runAllScrapers(): Promise<Property[]> {
  const scrapers = getActiveScrapers();
  const allProperties: Property[] = [];
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
      allProperties.push(...props);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      logger.info(
        `[scraper-service] ${scraper.source}: ${props.length} properties (${elapsed}s)`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      logger.error(
        `[scraper-service] ${scraper.source} failed after ${elapsed}s: ${reason}`,
      );
      failures.push({ source: scraper.source, reason });
      // Skip to the next scraper
    }
  }

  // Consolidated error summary at the end of the run
  if (failures.length > 0) {
    logger.error(
      `[scraper-service] ${failures.length} scraper(s) failed:`,
    );
    for (const failure of failures) {
      logger.error(`[scraper-service]   - ${failure.source}: ${failure.reason}`);
    }
  }

  logger.info(`Total collected: ${allProperties.length} properties`);
  return allProperties;
}
