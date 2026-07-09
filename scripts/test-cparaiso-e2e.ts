/**
 * CParaiso E2E Test
 *
 * Usage: npx tsx scripts/test-cparaiso-e2e.ts
 */

import { CParaisoScraper } from "../src/scrapers/cparaiso/cparaiso.scraper.js";

async function main() {
  console.log("=== CParaiso E2E Test ===\n");

  const scraper = new CParaisoScraper();
  const results = await scraper.scrape();

  console.log(`\n=== Results: ${results.length} properties ===\n`);

  for (const prop of results) {
    console.log("────────────────────────────────────────────────────────────");
    console.log(`ID:       ${prop.externalId || "N/A"}`);
    console.log(`Title:    ${prop.title}`);
    console.log(`Price:    ${prop.price.toLocaleString()} €`);
    console.log(`Type:     ${prop.auctionType || "N/A"}`);
    console.log(`Location: ${prop.location} (${prop.district || "N/A"} / ${prop.municipality || "N/A"})`);
    console.log(`Status:   ${prop.status || "N/A"}`);
    console.log(`Images:   ${prop.images.length}`);
    console.log(`URL:      ${prop.url}`);
    console.log(`Desc:     ${prop.description?.substring(0, 100)}...`);
  }

  console.log("\n============================================================");
  console.log("SUMMARY");
  console.log("============================================================");
  console.log(`Total properties:     ${results.length}`);
  console.log(`With price:           ${results.filter(p => p.price > 0).length}`);
  console.log(`With images:          ${results.filter(p => p.images.length > 0).length}`);
  console.log(`With description:     ${results.filter(p => p.description).length}`);
  console.log(`With district:        ${results.filter(p => p.district).length}`);

  const auctionTypes = new Map<string, number>();
  for (const prop of results) {
    const type = prop.auctionType || "Unknown";
    auctionTypes.set(type, (auctionTypes.get(type) || 0) + 1);
  }

  console.log("\nAuction types:");
  auctionTypes.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });
}

main().catch(console.error);