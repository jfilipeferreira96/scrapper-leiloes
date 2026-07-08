/**
 * End-to-end test for the VLeiloes scraper.
 *
 * Usage: npx tsx scripts/test-vleiloes-e2e.ts
 */

import { VLeiloesScraper } from "../src/scrapers/vleiloes/vleiloes.scraper.js";

async function main() {
  console.log("=== VLeiloes E2E Test ===\n");

  const scraper = new VLeiloesScraper();
  const properties = await scraper.scrape();

  console.log(`\n=== Results: ${properties.length} properties ===\n`);

  for (const p of properties) {
    console.log("─".repeat(60));
    console.log(`ID:       ${p.externalId}`);
    console.log(`Title:    ${p.title}`);
    console.log(`Price:    ${p.price} €`);
    console.log(`Type:     ${p.auctionType}`);
    console.log(`Location: ${p.location}`);
    console.log(`Coords:   ${p.latitude || "—"}, ${p.longitude || "—"}`);
    console.log(`Images:   ${p.images.length}`);
    console.log(`URL:      ${p.url}`);
    if (p.description) {
      const desc = p.description.length > 120
        ? p.description.substring(0, 120) + "..."
        : p.description;
      console.log(`Desc:     ${desc}`);
    }
  }

  printSummary(properties);
}

function printSummary(properties: any[]) {
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total properties:     ${properties.length}`);
  console.log(`With price:           ${properties.filter((p) => p.price > 0).length}`);
  console.log(`With coordinates:     ${properties.filter((p) => p.latitude).length}`);
  console.log(`With images:          ${properties.filter((p) => p.images.length > 0).length}`);
  console.log(`With description:     ${properties.filter((p) => p.description).length}`);

  const types: Record<string, number> = {};
  for (const p of properties) {
    const t = p.auctionType || "Unknown";
    types[t] = (types[t] || 0) + 1;
  }
  console.log("\nAuction types:");
  for (const [type, count] of Object.entries(types)) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);