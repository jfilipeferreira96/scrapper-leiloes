import { SolventiumScraper } from "../src/scrapers/solventium/solventium.scraper.js";
import { logger } from "../src/utils/logger.js";
import type { Property } from "../src/models/property.js";

async function testSolventiumE2E() {
  console.log("=== Solventium E2E Test ===\n");

  const scraper = new SolventiumScraper();
  logger.info("[solventium] Starting scrape");

  const startTime = Date.now();
  const properties = await scraper.scrape();
  const duration = (Date.now() - startTime) / 1000;

  logger.info(`[solventium] Scrape complete: ${properties.length} complete properties`);

  console.log(`\n=== Results: ${properties.length} properties ===\n`);

  // Display summary
  const withPrice = properties.filter((p) => p.price > 0).length;
  const withImages = properties.filter((p) => p.images.length > 0).length;
  const withDescription = properties.filter((p) => p.description && p.description.length > 0).length;

  // Display first 5 properties
  const displayCount = Math.min(5, properties.length);
  for (let i = 0; i < displayCount; i++) {
    const p = properties[i];
    console.log("────────────────────────────────────────────────────────────");
    console.log(`ID:       ${p.externalId}`);
    console.log(`Title:    ${p.title}`);
    console.log(`Price:    ${p.price.toLocaleString("pt-PT")} €`);
    console.log(`Type:     ${p.auctionType}`);
    console.log(`Location: ${p.location}`);
    console.log(`Coords:   ${p.district || "—"}, ${p.municipality || "—"}`);
    console.log(`Images:   ${p.images.length}`);
    console.log(`URL:      ${p.url}`);
    console.log(`Desc:     ${p.description?.substring(0, 100)}...`);
  }

  if (properties.length > 5) {
    console.log("────────────────────────────────────────────────────────────");
    console.log(`... and ${properties.length - 5} more properties`);
  }

  console.log("\n============================================================");
  console.log("SUMMARY");
  console.log("============================================================");
  console.log(`Total properties:     ${properties.length}`);
  console.log(`With price:           ${withPrice}`);
  console.log(`With coordinates:     ${properties.filter((p) => p.district || p.municipality).length}`);
  console.log(`With images:          ${withImages}`);
  console.log(`With description:     ${withDescription}`);
  console.log(`Duration:             ${duration.toFixed(2)}s`);

  // Group by auction type
  const byType: Record<string, number> = {};
  for (const p of properties) {
    const type = p.auctionType || "Unknown";
    byType[type] = (byType[type] || 0) + 1;
  }

  console.log("\nAuction types:");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\n============================================================");

  if (properties.length === 0) {
    console.error("❌ FAILED: No properties found");
    process.exit(1);
  }

  console.log("✅ SUCCESS: Solventium scraper working correctly");
}

testSolventiumE2E().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});