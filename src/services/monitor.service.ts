import type { Property } from "../models/property.js";
import { propertyKey } from "../models/property.js";
import { ExcelService } from "../database/excel.service.js";
import { runAllScrapers } from "./scraper.service.js";
import { diffProperties } from "./property.service.js";
import { logger } from "../utils/logger.js";
import type { PropertyDiff } from "../models/property.js";

export interface MonitoringResult {
  newProperties: Property[];
  diffs: PropertyDiff[];
}

export async function runMonitoring(): Promise<MonitoringResult> {
  logger.info("=== Starting monitoring run ===");

  const current = await runAllScrapers();
  logger.info(`Scraped ${current.length} properties from active sources`);

  const excelService = new ExcelService();
  const previousMap = await excelService.readProperties();
  const previous = Array.from(previousMap.values());
  logger.info(`Loaded ${previous.length} properties from previous run`);

  const previousKeys = new Set(previous.map((p) => p.key || propertyKey(p.source, p.externalId)));
  const newProperties = current.filter((p) => !previousKeys.has(propertyKey(p.source, p.externalId)));
  logger.info(`Found ${newProperties.length} new properties`);

  const { updatedRecords, diffs, history } = diffProperties(current, previousMap);
  await excelService.writeResults(updatedRecords, diffs, history, previous.length === 0);
  logger.info("Saved all properties to Excel");

  logger.info("=== Monitoring run complete ===");
  return { newProperties, diffs };
}
