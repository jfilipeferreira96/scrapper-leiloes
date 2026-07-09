import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { fetchPage } from '../../utils/http.js';
import { parseMaximovalorListing, parseMaximovalorDetail, extractPagination } from './maximovalor.parser.js';

const BASE_URL = 'https://www.maximovalor.pt';

// 4 auction types to scrape
const AUCTION_TYPES = [
  'leiloes-presenciais',
  'leiloes-eletronicos',
  'carta-fechada',
  'negociacao-particular',
];

// Filter parameters for Imóveis (categoria=2)
const FILTER_PARAMS = '?titulo=&categoria=2&distrito=&concelho=&freguesia=';

export class MaximovalorScraper extends BaseScraper {
  readonly source = 'maximovalor';

  /**
   * Collect listings from all 4 auction types with pagination.
   */
  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

    for (const auctionType of AUCTION_TYPES) {
      try {
        let currentUrl = `${BASE_URL}/${auctionType}${FILTER_PARAMS}`;
        
        while (currentUrl) {
          const html = await fetchPage(currentUrl);
          const properties = parseMaximovalorListing(html, auctionType);
          allProperties.push(...properties);
          
          // Extract next page URL
          const nextUrl = extractPagination(html, currentUrl);
          
          // Add delay between pagination requests
          if (nextUrl) {
            await this.delay(500);
          }
          
          currentUrl = nextUrl || '';
        }
      } catch (error) {
        console.error(`[${this.source}] Error scraping ${auctionType}:`, error);
      }
    }

    return allProperties;
  }

  /**
   * Enrich a single Property with detail page data.
   */
  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    const detail = parseMaximovalorDetail(detailHtml, base.url);
    
    return {
      ...base,
      ...detail,
    };
  }
}