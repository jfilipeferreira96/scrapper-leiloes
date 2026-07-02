import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import type { PropertyRecord, PropertyDiff } from "../models/property.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Formats a Date to Portuguese format: DD-MM-YYYY HH:mm:ss
 */
function formatDate(date: Date | undefined | null): string {
  if (!date) return "";

  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// Column definitions for the Properties sheet.
// Order: all display columns first, then Chave and ID Externo at the end.
const PROPERTY_COLUMNS = [
  { header: "Fonte", key: "A", width: 12 },
  { header: "Título", key: "B", width: 40 },
  { header: "Preço (€)", key: "C", width: 14 },
  { header: "Valor Abertura (€)", key: "D", width: 18 },
  { header: "Valor Mínimo (€)", key: "E", width: 16 },
  { header: "Licitação Atual (€)", key: "F", width: 18 },
  { header: "Preço Anterior (€)", key: "G", width: 16 },
  { header: "Localização", key: "H", width: 28 },
  { header: "Distrito", key: "I", width: 15 },
  { header: "Concelho", key: "J", width: 20 },
  { header: "Freguesia", key: "K", width: 20 },
  { header: "Área (m²)", key: "L", width: 11 },
  { header: "Divisões", key: "M", width: 10 },
  { header: "Estado", key: "N", width: 18 },
  { header: "URL", key: "O", width: 55 },
  { header: "Imagens", key: "P", width: 40 },
  { header: "Latitude", key: "Q", width: 12 },
  { header: "Longitude", key: "R", width: 12 },
  { header: "Publicado em", key: "S", width: 20 },
  { header: "Primeira Detecção", key: "T", width: 22 },
  { header: "Última Verificação", key: "U", width: 22 },
  { header: "Chave", key: "V", width: 22 },
  { header: "ID Externo", key: "W", width: 15 },
] as const;

// Highlight colors
const COLORS = {
  NEW: { fill: "C6EFCE", font: "006100" },
  PRICE_CHANGE: { fill: "FFEB9C", font: "9C6500" },
  REMOVED: { fill: "FFC7CE", font: "9C0006" },
};

export interface HistoryEntry {
  timestamp: string;
  key: string;
  event: string;
  detail: string;
  source: string;
}

export class ExcelService {
  public filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || config.excelPath;
  }

  /**
   * Reads all existing records from the Propriedades sheet.
   * Returns an empty Map if the file does not exist yet.
   */
  async readProperties(): Promise<Map<string, PropertyRecord>> {
    const map = new Map<string, PropertyRecord>();

    if (!fs.existsSync(this.filePath)) {
      logger.info("Excel DB does not exist — will be created on first run");
      return map;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath);
    let sheet = workbook.getWorksheet("Propriedades");
    if (!sheet) {
      // Try old "Properties" name for backward compatibility
      const oldSheet = workbook.getWorksheet("Properties");
      if (!oldSheet) return map;
      sheet = oldSheet;
    }

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const values = row.values as any[];
      const record: PropertyRecord = {
        source: values[1],
        title: values[2],
        price: Number(values[3]) || 0,
        openingValue: values[4] ? Number(values[4]) : undefined,
        minSaleValue: values[5] ? Number(values[5]) : undefined,
        currentBid: values[6] ? Number(values[6]) : undefined,
        previousPrice: values[7] ? Number(values[7]) : undefined,
        location: values[8] || "",
        district: values[9],
        municipality: values[10],
        parish: values[11],
        area: values[12] ? Number(values[12]) : undefined,
        rooms: values[13] ? Number(values[13]) : undefined,
        status: values[14],
        url: values[15] || "",
        images: values[16] ? String(values[16]).split(";") : [],
        latitude: values[17] ? Number(values[17]) : undefined,
        longitude: values[18] ? Number(values[18]) : undefined,
        publishedAt: values[19] ? new Date(values[19]) : undefined,
        firstSeenAt: values[20] ? new Date(values[20]) : new Date(),
        lastSeenAt: values[21] ? new Date(values[21]) : new Date(),
        key: values[22],
        externalId: values[23],
      };
      map.set(record.key, record);
    });

    logger.info(`Excel DB: ${map.size} properties loaded`);
    return map;
  }

  /**
   * Writes the full state: Propriedades (updated), Novos (this run only),
   * Histórico (append with full property data). Applies row highlighting.
   */
  async writeResults(
    allRecords: PropertyRecord[],
    diffs: PropertyDiff[],
    historyEntries: HistoryEntry[],
    isFirstRun: boolean
  ): Promise<void> {
    // Ensure the output directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing workbook (to preserve Histórico) or create a new one
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(this.filePath)) {
      await workbook.xlsx.readFile(this.filePath);
    }

    const oldNewSheet = workbook.getWorksheet("New");
    if (oldNewSheet) workbook.removeWorksheet(oldNewSheet.id);

    // --- Sheet: Propriedades (full rewrite) ---
    let propSheet = workbook.getWorksheet("Propriedades");
    if (propSheet) workbook.removeWorksheet(propSheet.id);
    const oldPropSheet = workbook.getWorksheet("Properties");
    if (oldPropSheet) workbook.removeWorksheet(oldPropSheet.id);
    propSheet = workbook.addWorksheet("Propriedades");
    PROPERTY_COLUMNS.forEach((col) => {
      propSheet!.getColumn(col.key).width = col.width;
    });
    const propHeader = propSheet.addRow(PROPERTY_COLUMNS.map((c) => c.header));
    propHeader.font = { bold: true };
    propHeader.alignment = { vertical: "middle" };

    const diffMap = new Map(diffs.map((d) => [d.record.key, d]));

    allRecords.forEach((record) => {
      // Write as ARRAY so values are placed in the correct columns
      // Order: all display columns first, then Chave and ID Externo at the end
      const row = propSheet!.addRow([
        record.source,
        record.title,
        record.price,
        record.openingValue ?? "",
        record.minSaleValue ?? "",
        record.currentBid ?? "",
        record.previousPrice ?? "",
        record.location,
        record.district ?? "",
        record.municipality ?? "",
        record.parish ?? "",
        record.area ?? "",
        record.rooms ?? "",
        record.status ?? "",
        record.url,
        record.images.join(";"),
        record.latitude ?? "",
        record.longitude ?? "",
        formatDate(record.publishedAt),
        formatDate(record.firstSeenAt),
        formatDate(record.lastSeenAt),
        record.key,
        record.externalId,
      ]);
      // Highlighting
      const diff = diffMap.get(record.key);
      if (diff) {
        this.applyHighlight(row, diff.changeType);
      }
    });

    // --- Sheet: Novos (full rewrite — only new properties from this run)
    // Skip if this is the first run (empty existing DB)
    let newSheet = workbook.getWorksheet("Novos");
    if (newSheet) workbook.removeWorksheet(newSheet.id);
    newSheet = workbook.addWorksheet("Novos");
    PROPERTY_COLUMNS.forEach((col) => {
      newSheet!.getColumn(col.key).width = col.width;
    });
    const newHeader = newSheet.addRow(PROPERTY_COLUMNS.map((c) => c.header));
    newHeader.font = { bold: true };

    const newDiffs = diffs.filter((d) => d.changeType === "NEW");
    // Skip "Novos" on first run (all properties are new — would duplicate Propriedades).
    // On subsequent runs, only genuinely new properties appear.
    if (!isFirstRun) {
      newDiffs.forEach((d) => {
        const r = d.record;
        const row = newSheet!.addRow([
          r.source,
          r.title,
          r.price,
          r.openingValue ?? "",
          r.minSaleValue ?? "",
          r.currentBid ?? "",
          r.previousPrice ?? "",
          r.location,
          r.district ?? "",
          r.municipality ?? "",
          r.parish ?? "",
          r.area ?? "",
          r.rooms ?? "",
          r.status ?? "",
          r.url,
          r.images.join(";"),
          r.latitude ?? "",
          r.longitude ?? "",
          formatDate(r.publishedAt),
          formatDate(r.firstSeenAt),
          formatDate(r.lastSeenAt),
          r.key,
          r.externalId,
        ]);
        this.applyHighlight(row, "NEW");
      });
    }

    // --- Sheet: Histórico (append with full property data) ---
    let histSheet = workbook.getWorksheet("Histórico");
    if (!histSheet) {
      histSheet = workbook.addWorksheet("Histórico");
      // Use the same columns as Propriedades
      PROPERTY_COLUMNS.forEach((col) => {
        histSheet!.getColumn(col.key).width = col.width;
      });
      const histHeader = histSheet.addRow(PROPERTY_COLUMNS.map((c) => c.header));
      histHeader.font = { bold: true };
    }

    // Append history entries with full property data
    historyEntries.forEach((entry) => {
      // Find the property record for this history entry
      const record = allRecords.find((r) => r.key === entry.key);
      if (!record) return;

      const row = histSheet!.addRow([
        record.source,
        record.title,
        record.price,
        record.openingValue ?? "",
        record.minSaleValue ?? "",
        record.currentBid ?? "",
        record.previousPrice ?? "",
        record.location,
        record.district ?? "",
        record.municipality ?? "",
        record.parish ?? "",
        record.area ?? "",
        record.rooms ?? "",
        record.status ?? "",
        record.url,
        record.images.join(";"),
        record.latitude ?? "",
        record.longitude ?? "",
        formatDate(record.publishedAt),
        formatDate(record.firstSeenAt),
        formatDate(record.lastSeenAt),
        record.key,
        record.externalId,
      ]);
      // Add event and detail as additional columns at the end
      const eventCell = row.getCell(row.cellCount + 1);
      eventCell.value = entry.event;
      const detailCell = row.getCell(row.cellCount + 1);
      detailCell.value = entry.detail;
    });

    // Reorder sheets: Novos, Propriedades, Histórico
    workbook.worksheets.sort((a, b) => {
      const order = ["Novos", "Propriedades", "Histórico"];
      return order.indexOf(a.name) - order.indexOf(b.name);
    });

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Excel DB updated: ${this.filePath}`);
  }

  private applyHighlight(row: ExcelJS.Row, changeType: string): void {
    const colorKey =
      changeType === "NEW"
        ? "NEW"
        : changeType === "PRICE_CHANGE"
        ? "PRICE_CHANGE"
        : changeType === "REMOVED"
        ? "REMOVED"
        : null;

    if (!colorKey) return;

    const color = COLORS[colorKey as keyof typeof COLORS];
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + color.fill },
      };
      cell.font = { color: { argb: "FF" + color.font } };
    });
  }
}
