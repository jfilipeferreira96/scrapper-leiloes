/**
 * Monitor Service.
 *
 * Orchestrates the full monitoring pipeline:
 *  1. Scrape all active sources
 *  2. Identify new properties (vs. saved data)
 *  3. Save to Excel
 *  4. Send notifications (if enabled)
 *
 * This service extracts logic from app.ts for testability and reusability.
 */

import type { Property } from "../models/property.js";
import { propertyKey } from "../models/property.js";
import { ExcelService } from "../database/excel.service.js";
import { runAllScrapers } from "./scraper.service.js";
import { diffProperties } from "./property.service.js";
import { logger } from "../utils/logger.js";

/**
 * Run the full monitoring pipeline.
 *
 * @returns Array of new properties found
 */
export async function runMonitoring(): Promise<Property[]> {
  logger.info("=== Starting monitoring run ===");

  // Step 1: Scrape all active sources
  const current = await runAllScrapers();
  logger.info(`Scraped ${current.length} properties from active sources`);

  // Step 2: Load previous data for comparison
  const excelService = new ExcelService();
  const previousMap = await excelService.readProperties();
  const previous = Array.from(previousMap.values());
  logger.info(`Loaded ${previous.length} properties from previous run`);

  // Step 3: Identify new properties
  const previousKeys = new Set(previous.map((p) => p.key || propertyKey(p.source, p.externalId)));
  const newProperties = current.filter((p) => !previousKeys.has(propertyKey(p.source, p.externalId)));

  logger.info(`Found ${newProperties.length} new properties`);

  // Step 4: Save complete data to Excel
  const { updatedRecords, diffs, history } = diffProperties(current, previousMap);
  await excelService.writeResults(updatedRecords, diffs, history, previous.length === 0);
  logger.info("Saved all properties to Excel");

  // Step 5: Notify about new properties (if enabled)
  if (newProperties.length > 0) {
    logger.info(`Sending notifications for ${newProperties.length} new properties`);
    // TODO: integrate with notification.service.ts if needed
  }

  logger.info("=== Monitoring run complete ===");
  return newProperties;
}