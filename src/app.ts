import { runAllScrapers } from "./services/scraper.service.js";
import { diffProperties } from "./services/property.service.js";
import { ExcelService } from "./database/excel.service.js";
import { printSummary } from "./services/notification.service.js";
import { exportViewerData } from "./viewer/export.service.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info("=== Execution started ===");

  // 1. Load existing Excel database
  const excel = new ExcelService();
  const existing = await excel.readProperties();

  // 2. Run scrapers (already filtered by location)
  const scraped = await runAllScrapers();

  // 3. Diff against existing records
  const { diffs, updatedRecords, history } = diffProperties(
    scraped,
    existing
  );

  // 4. Update Excel database
  // isFirstRun = true when the DB had no records before this execution.
  // On first run, "Novos" sheet is skipped (all properties are new).
  const isFirstRun = existing.size === 0;
  await excel.writeResults(updatedRecords, diffs, history, isFirstRun);

  // 5. Export viewer data (Excel -> data/data.js)
  await exportViewerData(excel.filePath);

  // 6. Print summary
  printSummary(diffs);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`=== Execution finished (${elapsed}s) ===`);
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
