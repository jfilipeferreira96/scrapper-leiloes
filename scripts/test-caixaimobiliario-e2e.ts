#!/usr/bin/env tsx
import { CaixaimobiliarioScraper } from "../src/scrapers/caixaimobiliario/caixaimobiliario.scraper.js";

async function main() {
  console.log("🏠 Testing Caixa Imobiliário Scraper\n");
  console.log("=" .repeat(60));

  const scraper = new CaixaimobiliarioScraper();

  try {
    console.log("\n📋 Starting scrape...");
    const properties = await scraper.scrape();

    console.log(`\nScrape complete! Found ${properties.length} properties\n`);

    if (properties.length === 0) {
      console.log("⚠️  No properties found. This could mean:");
      console.log("   - The website structure has changed");
      console.log("   - All properties are foreign (filtered out)");
      console.log("   - Network issues or blocking");
      return;
    }

    const withImages = properties.filter((p) => p.images && p.images.length > 0).length;
    const withPrices = properties.filter((p) => p.price > 0).length;
    const withDescription = properties.filter((p) => p.description && p.description.length > 0).length;
    const withArea = properties.filter((p) => p.area && p.area > 0).length;

    console.log("Statistics:");
    console.log(`   Total properties: ${properties.length}`);
    console.log(`   With images: ${withImages} (${((withImages / properties.length) * 100).toFixed(1)}%)`);
    console.log(`   With prices: ${withPrices} (${((withPrices / properties.length) * 100).toFixed(1)}%)`);
    console.log(`   With description: ${withDescription} (${((withDescription / properties.length) * 100).toFixed(1)}%)`);
    console.log(`   With area: ${withArea} (${((withArea / properties.length) * 100).toFixed(1)}%)`);

    const pricedProperties = properties.filter((p) => p.price > 0);
    if (pricedProperties.length > 0) {
      const totalPrice = pricedProperties.reduce((sum, p) => sum + p.price, 0);
      const avgPrice = totalPrice / pricedProperties.length;
      const minPrice = Math.min(...pricedProperties.map((p) => p.price));
      const maxPrice = Math.max(...pricedProperties.map((p) => p.price));

      console.log("\n💰 Price Statistics:");
      console.log(`   Average: ${avgPrice.toLocaleString("pt-PT", { style: "currency", currency: "EUR" })}`);
      console.log(`   Min: ${minPrice.toLocaleString("pt-PT", { style: "currency", currency: "EUR" })}`);
      console.log(`   Max: ${maxPrice.toLocaleString("pt-PT", { style: "currency", currency: "EUR" })}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🏠 First 5 Properties:\n");

    properties.slice(0, 5).forEach((property, index) => {
      console.log(`${index + 1}. ${property.title}`);
      console.log(`   ID: ${property.externalId}`);
      console.log(`   Price: ${property.price > 0 ? property.price.toLocaleString("pt-PT", { style: "currency", currency: "EUR" }) : "N/A"}`);
      console.log(`   Location: ${property.location}`);
      if (property.municipality) console.log(`   Municipality: ${property.municipality}`);
      if (property.district) console.log(`   District: ${property.district}`);
      if (property.area) console.log(`   Area: ${property.area} m²`);
      console.log(`   Images: ${property.images?.length || 0}`);
      console.log(`   URL: ${property.url}`);
      console.log();
    });

    const byMunicipality: Record<string, number> = {};
    properties.forEach((p) => {
      const municipality = p.municipality || "Unknown";
      byMunicipality[municipality] = (byMunicipality[municipality] || 0) + 1;
    });

    console.log("=".repeat(60));
    console.log("📍 Properties by Municipality:\n");
    Object.entries(byMunicipality)
      .sort(([, a], [, b]) => b - a)
      .forEach(([municipality, count]) => {
        console.log(`   ${municipality}: ${count}`);
      });

  } catch (error) {
    console.error("\nError during scrape:");
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});