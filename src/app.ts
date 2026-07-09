/**
 * Application entry point.
 *
 * Boots the monitoring pipeline.
 */

import { runMonitoring } from "./services/monitor.service.js";
import { printSummary } from "./services/notification.service.js";
import { exportViewerData } from "./viewer/export.service.js";
import { ExcelService } from "./database/excel.service.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info("=== Execution started ===");

  // Run full monitoring pipeline
  const { newProperties, diffs } = await runMonitoring();

  // Export viewer data (Excel -> data/data.js)
  const excel = new ExcelService();
  await exportViewerData(excel.filePath);

  // Print summary with actual diff results
  printSummary(diffs);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`=== Execution finished (${elapsed}s) ===`);
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});