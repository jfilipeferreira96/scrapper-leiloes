import { LeiloatriumScraper } from '../src/scrapers/leiloatrium/leiloatrium.scraper.js';
import { logger } from '../src/utils/logger.js';

async function testLeiloatriumE2E() {
  logger.info('Starting Leiloatrium E2E test');
  
  const scraper = new LeiloatriumScraper();
  
  try {
    const properties = await scraper.scrape();
    
    logger.info(`\n=== Leiloatrium E2E Test Results ===`);
    logger.info(`Total properties scraped: ${properties.length}`);
    
    if (properties.length > 0) {
      logger.info(`\nSample property (first one):`);
      const sample = properties[0];
      logger.info(`  - Source: ${sample.source}`);
      logger.info(`  - ID: ${sample.externalId}`);
      logger.info(`  - Title: ${sample.title}`);
      logger.info(`  - Location: ${sample.location}`);
      logger.info(`  - Price: ${sample.price}€`);
      logger.info(`  - Min Sale Value: ${sample.minSaleValue}€`);
      logger.info(`  - Opening Value: ${sample.openingValue}€`);
      logger.info(`  - Auction Type: ${sample.auctionType}`);
      logger.info(`  - Status: ${sample.status}`);
      logger.info(`  - Images: ${sample.images.length}`);
      logger.info(`  - URL: ${sample.url}`);
      
      if (sample.description) {
        logger.info(`  - Description length: ${sample.description.length} chars`);
      }
      
      if (sample.latitude && sample.longitude) {
        logger.info(`  - Coordinates: ${sample.latitude}, ${sample.longitude}`);
      }
    }
    
    // Count by auction type
    const byType = properties.reduce((acc, p) => {
      const type = p.auctionType || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    logger.info(`\nProperties by auction type:`);
    Object.entries(byType).forEach(([type, count]) => {
      logger.info(`  - ${type}: ${count}`);
    });
    
    // Count by status
    const byStatus = properties.reduce((acc, p) => {
      const status = p.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    logger.info(`\nProperties by status:`);
    Object.entries(byStatus).forEach(([status, count]) => {
      logger.info(`  - ${status}: ${count}`);
    });
    
    logger.info(`\n=== Test Complete ===`);
  } catch (error) {
    logger.error('Leiloatrium E2E test failed:', error);
    process.exit(1);
  }
}

testLeiloatriumE2E();