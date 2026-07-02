/**
 * Unified property model. All scrapers return this type.
 */
export interface Property {
  source: string;
  externalId: string;
  title: string;
  description?: string;
  price: number;
  openingValue?: number;
  minSaleValue?: number;
  currentBid?: number; 
  location: string;
  district?: string;
  municipality?: string;
  parish?: string;
  area?: number;
  rooms?: number;
  url: string;
  images: string[];
  latitude?: number;
  longitude?: number;
  status?: string;
  publishedAt?: Date;
}

/**
 * Internal record stored in the Excel DB (Property + tracking metadata).
 */
export interface PropertyRecord extends Property {
  key: string;
  previousPrice?: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export type ChangeType =
  | "NEW"
  | "PRICE_CHANGE"
  | "STATUS_CHANGE"
  | "UNCHANGED"
  | "REMOVED";

export interface PropertyDiff {
  record: PropertyRecord;
  changeType: ChangeType;
  previousPrice?: number;
  previousStatus?: string;
}


export function propertyKey(source: string, externalId: string): string {
  return `${source}_${externalId}`;
}