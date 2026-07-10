import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { fetchPage } from '../../utils/http.js';
import { parseMaximovalorListing, parseMaximovalorDetail, extractPagination } from './maximovalor.parser.js';

const BASE_URL = 'https://www.maximovalor.pt';

const AUCTION_TYPES = [
  'leiloes-presenciais',
  'leiloes-eletronicos',
  'carta-fechada',
  'negociacao-particular',
];

// categoria=2 filters to Imóveis
const FILTER_PARAMS = '?titulo=&categoria=2&distrito=&concelho=&freguesia=';

export class MaximovalorScraper extends BaseScraper {
  readonly source = 'maximovalor';

  protected async collectListings(): Promise<Property[]> {
    const allProperties: Property[] = [];

    for (const auctionType of AUCTION_TYPES) {
      try {
        let currentUrl = `${BASE_URL}/${auctionType}${FILTER_PARAMS}`;
        
        while (currentUrl) {
          const html = await fetchPage(currentUrl);
          const properties = parseMaximovalorListing(html, auctionType);
          allProperties.push(...properties);
          
          const nextUrl = extractPagination(html, currentUrl);
          
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

  protected async enrichDetail(base: Property): Promise<Property> {
    const detailHtml = await fetchPage(base.url);
    const detail = parseMaximovalorDetail(detailHtml, base.url);
    
    return {
      ...base,
      ...detail,
    };
  }
}
