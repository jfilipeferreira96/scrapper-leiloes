import { BaseScraper } from '../base.scraper.js';
import { Property } from '../../models/property.js';
import { parseListings, parseDetail, parseStatus, type ExclusivagoraListing, type ExclusivagoraDetail } from './exclusivagora.parser.js';
import { logger } from '../../utils/logger.js';

export class ExclusivagoraScraper extends BaseScraper {
  readonly source = 'exclusivagora';
  private readonly baseUrl = 'https://www.exclusivagora.com/?page=vendas';

  /**
   * Collect all listings from the main page
   */
  protected async collectListings(): Promise<Property[]> {
    logger.info(`Fetching exclusivagora listings from ${this.baseUrl}`);
    
    const html = await this.fetchPage(this.baseUrl);
    const listings = parseListings(html);
    
    logger.info(`Found ${listings.length} listings on exclusivagora`);
    
    return listings.map(listing => ({
      source: this.source,
      externalId: listing.externalId,
      title: listing.title,
      location: listing.location,
      url: listing.detailUrl,
      images: listing.image ? [listing.image] : [],
      price: 0, // Will be enriched from detail page
      auctionType: listing.auctionType,
      status: 'active'
    }));
  }

  /**
   * Enrich a property with details from its detail page
   */
  protected async enrichDetail(property: Property): Promise<Property> {
    if (!property.url) {
      return property;
    }

    try {
      logger.info(`Fetching details for exclusivagora property ${property.externalId}`);
      
      const html = await this.fetchPage(property.url);
      const detail = parseDetail(html);
      
      if (!detail) {
        logger.warn(`Failed to parse detail page for ${property.externalId}`);
        return property;
      }

      // Determine status from countdown
      const status = parseStatus(detail.countdown);

      // Combine description and notes
      let finalDescription = detail.description;
      if (detail.notes) {
        finalDescription += `\n\nNotas:\n${detail.notes}`;
      }

      // Add documents to description
      if (detail.documents.length > 0) {
        finalDescription += '\n\nDocumentos:\n' + detail.documents.map(d => `- ${d}`).join('\n');
      }

      return {
        ...property,
        title: detail.title || property.title,
        description: finalDescription,
        location: detail.location || property.location,
        auctionType: detail.auctionType || property.auctionType,
        price: detail.price || property.price,
        minSaleValue: detail.minSaleValue,
        openingValue: detail.openingValue,
        currentBid: detail.currentBid,
        images: detail.images.length > 0 ? detail.images : property.images,
        status
      };
    } catch (error) {
      logger.error(`Error fetching details for ${property.externalId}:`, error);
      return property;
    }
  }
}