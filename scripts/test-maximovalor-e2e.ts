#!/usr/bin/env node
import { MaximovalorScraper } from '../src/scrapers/maximovalor/maximovalor.scraper.js';

async function main() {
  console.log('Testing Maximovalor scraper...\n');
  
  const scraper = new MaximovalorScraper();
  const properties = await scraper.scrape();
  
  console.log(`\nFound ${properties.length} properties\n`);
  console.log('='.repeat(80));
  
  // Group by auction type
  const byType = properties.reduce((acc, prop) => {
    const type = prop.auctionType || 'unknown';
    if (!acc[type]) acc[type] = [];
    acc[type].push(prop);
    return acc;
  }, {} as Record<string, typeof properties>);
  
  // Display properties grouped by type
  for (const [type, props] of Object.entries(byType)) {
    console.log(`\n${type.toUpperCase()} (${props.length} properties)`);
    console.log('='.repeat(80));
    
    props.forEach((prop, index) => {
      console.log(`\n[${index + 1}] ${prop.source} - ${prop.externalId}`);
      console.log(`Title: ${prop.title}`);
      console.log(`Location: ${prop.location}`);
      console.log(`Price: ${prop.price.toFixed(2)} €`);
      if (prop.openingValue) console.log(`Opening Value: ${prop.openingValue.toFixed(2)} €`);
      if (prop.minSaleValue) console.log(`Min Sale Value: ${prop.minSaleValue.toFixed(2)} €`);
      if (prop.currentBid) console.log(`Current Bid: ${prop.currentBid.toFixed(2)} €`);
      console.log(`URL: ${prop.url}`);
      console.log(`Images: ${prop.images?.length || 0}`);
      if (prop.publishedAt) console.log(`End Date: ${prop.publishedAt.toLocaleString('pt-PT')}`);
      if (prop.district) console.log(`District: ${prop.district}`);
      if (prop.municipality) console.log(`Municipality: ${prop.municipality}`);
      if (prop.description) {
        console.log(`Description: ${prop.description.substring(0, 200)}...`);
      }
      console.log('-'.repeat(80));
    });
  }
  
  // Summary statistics
  const totalValue = properties.reduce((sum, p) => sum + p.price, 0);
  const withImages = properties.filter(p => p.images && p.images.length > 0).length;
  const withPrice = properties.filter(p => p.price > 0).length;
  const withOpeningValue = properties.filter(p => p.openingValue && p.openingValue > 0).length;
  const withCurrentBid = properties.filter(p => p.currentBid && p.currentBid > 0).length;
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total properties: ${properties.length}`);
  console.log(`Total value: ${totalValue.toFixed(2)} €`);
  console.log(`Properties with images: ${withImages} (${((withImages/properties.length)*100).toFixed(1)}%)`);
  console.log(`Properties with price: ${withPrice} (${((withPrice/properties.length)*100).toFixed(1)}%)`);
  console.log(`Properties with opening value: ${withOpeningValue} (${((withOpeningValue/properties.length)*100).toFixed(1)}%)`);
  console.log(`Properties with current bid: ${withCurrentBid} (${((withCurrentBid/properties.length)*100).toFixed(1)}%)`);
  console.log(`Average value: ${(totalValue / properties.length).toFixed(2)} €`);
  
  // Auction type breakdown
  console.log('\n' + '='.repeat(80));
  console.log('BY AUCTION TYPE');
  console.log('='.repeat(80));
  for (const [type, props] of Object.entries(byType)) {
    const typeValue = props.reduce((sum, p) => sum + p.price, 0);
    console.log(`${type}: ${props.length} properties, total value: ${typeValue.toFixed(2)} €`);
  }
}

main().catch(console.error);