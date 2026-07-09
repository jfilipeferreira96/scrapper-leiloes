#!/usr/bin/env node
import { ViaserumosScraper } from '../src/scrapers/viaserumos/viaserumos.scraper.js';

async function main() {
  console.log('Testing Viaserumos scraper...\n');
  
  const scraper = new ViaserumosScraper();
  const properties = await scraper.scrape();
  
  console.log(`\nFound ${properties.length} properties\n`);
  console.log('='.repeat(80));
  
  properties.forEach((prop, index) => {
    console.log(`\n[${index + 1}] ${prop.source} - ${prop.externalId}`);
    console.log(`Title: ${prop.title}`);
    console.log(`Location: ${prop.location}`);
    console.log(`Price: ${prop.price.toFixed(2)} €`);
    console.log(`Auction Type: ${prop.auctionType || 'N/A'}`);
    console.log(`Status: ${prop.status || 'N/A'}`);
    console.log(`URL: ${prop.url}`);
    console.log(`Images: ${prop.images?.length || 0}`);
    if (prop.openingValue) console.log(`Opening Value: ${prop.openingValue.toFixed(2)} €`);
    if (prop.minSaleValue) console.log(`Min Sale Value: ${prop.minSaleValue.toFixed(2)} €`);
    if (prop.currentBid) console.log(`Current Bid: ${prop.currentBid.toFixed(2)} €`);
    if (prop.publishedAt) console.log(`End Date: ${prop.publishedAt.toLocaleString('pt-PT')}`);
    if (prop.description) {
      console.log(`Description: ${prop.description.substring(0, 200)}...`);
    }
    console.log('-'.repeat(80));
  });
  
  // Summary statistics
  const totalValue = properties.reduce((sum, p) => sum + p.price, 0);
  const withImages = properties.filter(p => p.images && p.images.length > 0).length;
  const withPrice = properties.filter(p => p.price > 0).length;
  const withOpeningValue = properties.filter(p => p.openingValue && p.openingValue > 0).length;
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total properties: ${properties.length}`);
  console.log(`Total value: ${totalValue.toFixed(2)} €`);
  console.log(`Properties with images: ${withImages} (${((withImages/properties.length)*100).toFixed(1)}%)`);
  console.log(`Properties with price: ${withPrice} (${((withPrice/properties.length)*100).toFixed(1)}%)`);
  console.log(`Properties with opening value: ${withOpeningValue} (${((withOpeningValue/properties.length)*100).toFixed(1)}%)`);
  console.log(`Average value: ${(totalValue / properties.length).toFixed(2)} €`);
}

main().catch(console.error);