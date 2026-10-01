import { EleiloesScraper } from "../src/scrapers/eleiloes/eleiloes.scraper.js";

async function main() {
  console.log("=== e-leiloes E2E Test ===\n");

  const scraper = new EleiloesScraper();
  const properties = await scraper.scrape();

  console.log(`\n=== Results: ${properties.length} properties ===\n`);

  for (const p of properties) {
    console.log("=".repeat(60));
    console.log(`ID:       ${p.externalId}`);
    console.log(`Title:    ${p.title}`);
    console.log(`Price:    ${p.price} €`);
    console.log(`Location: ${p.location}`);
    console.log(`Images:   ${p.images.length}`);
    console.log(`URL:      ${p.url}`);
    if (p.description) {
      const desc = p.description.length > 120
        ? p.description.substring(0, 120) + "..."
        : p.description;
      console.log(`Desc:     ${desc}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total properties:     ${properties.length}`);

  const withPrice = properties.filter((p) => p.price > 0).length;
  console.log(`With price:           ${withPrice}`);

  const withImages = properties.filter((p) => p.images.length > 0).length;
  console.log(`With images:          ${withImages}`);

  const withDesc = properties.filter((p) => p.description).length;
  console.log(`With description:     ${withDesc}`);
}

main().catch(console.error).finally(() => process.exit(0));
