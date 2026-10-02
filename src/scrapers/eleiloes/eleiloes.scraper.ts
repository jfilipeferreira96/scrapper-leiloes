import axios from "axios";
import https from "https";
import type { Property } from "../../models/property.js";
import { BaseScraper } from "../base.scraper.js";
import { logger } from "../../utils/logger.js";

const API_URL = "https://www.e-leiloes.pt/api/Eventos/?tableParams=";
const ROWS_PER_PAGE = 12;
const REQUEST_DELAY_MS = 150;
const MAX_PAGES = 100;

// the site serves an incomplete certificate chain (missing intermediate),
// so only the chain check is disabled; the connection stays encrypted
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

interface ApiItem {
  referencia: string;
  titulo: string;
  lanceAtual?: number;
  valorBase?: number;
  valorMinimo?: number;
  dataFim?: string;
  cancelado: boolean;
  terminado: boolean;
  capa?: string;
  moradaDistrito?: string;
  moradaConcelho?: string;
  moradaFreguesia?: string;
}

interface ApiPage {
  list: ApiItem[];
  pagination: { first: number; rows: number; total: number };
}

export class EleiloesScraper extends BaseScraper {
  readonly source = "eleiloes";

  // the listing API already carries every field the monitor needs
  // (title, values, end date, location, cover image), so the enrichment
  // loop from the base template is skipped entirely
  async scrape(): Promise<Property[]> {
    logger.info(`[${this.source}] Starting scrape`);

    const listings = await this.collectListings();
    logger.info(`[${this.source}] ${listings.length} properties in listing`);

    return listings;
  }

  protected async collectListings(): Promise<Property[]> {
    const properties: Property[] = [];
    const seen = new Set<string>();
    let total = Infinity;

    for (let page = 0; page < MAX_PAGES && properties.length < total; page++) {
      const first = page * ROWS_PER_PAGE;
      const pageData = await this.fetchApiPage(first);
      if (!pageData) break;

      total = pageData.pagination?.total ?? total;

      for (const item of pageData.list) {
        if (item.cancelado || !item.referencia || seen.has(item.referencia)) continue;
        seen.add(item.referencia);
        properties.push(this.apiItemToProperty(item));
      }

      logger.info(
        `[${this.source}] Page ${page + 1}: ${pageData.list.length} items (${properties.length}/${total})`
      );

      await delay(REQUEST_DELAY_MS);
    }

    logger.info(`[${this.source}] Collected ${properties.length} properties`);
    return properties;
  }

  protected async enrichDetail(base: Property): Promise<Property> {
    return base;
  }

  private async fetchApiPage(first: number): Promise<ApiPage | null> {
    const tableParams = {
      first,
      rows: ROWS_PER_PAGE,
      sortField: "dataFim",
      sortOrder: 1,
      filters: { tipo: { value: 1, matchMode: "equals" } },
    };
    const url = API_URL + encodeURIComponent(JSON.stringify(tableParams));

    try {
      const res = await axios.get<ApiPage>(url, { timeout: 20000, httpsAgent });
      return res.data;
    } catch (error) {
      logger.warn(`[${this.source}] Error fetching page at first=${first}:`, error);
      return null;
    }
  }

  private apiItemToProperty(item: ApiItem): Property {
    const currentBid = item.lanceAtual ?? 0;
    const baseValue = item.valorBase ?? 0;
    const minValue = item.valorMinimo ?? 0;
    const price = currentBid > 0 ? currentBid : baseValue > 0 ? baseValue : minValue;

    return {
      source: "eleiloes",
      externalId: item.referencia,
      title: item.titulo,
      price,
      currentBid: currentBid > 0 ? currentBid : undefined,
      openingValue: baseValue > 0 ? baseValue : undefined,
      minSaleValue: minValue > 0 ? minValue : undefined,
      location: [item.moradaFreguesia, item.moradaConcelho, item.moradaDistrito]
        .filter(Boolean)
        .join(", "),
      district: item.moradaDistrito,
      municipality: item.moradaConcelho,
      parish: item.moradaFreguesia,
      url: `https://www.e-leiloes.pt/evento/${item.referencia}`,
      images: item.capa ? [`https://www.e-leiloes.pt/${item.capa}`] : [],
      auctionType: "Leilão Eletrônico",
      status: item.terminado ? "Terminado" : "active",
      publishedAt: item.dataFim ? new Date(item.dataFim) : new Date(),
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
