import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import type { PropertyRecord, PropertyDiff } from "../models/property.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(date: Date | undefined | null): string {
  if (!date) return "";
  const d = new Date(date);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function parseExcelDate(raw: unknown): Date | undefined {
  if (raw instanceof Date) return raw;
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (iso) {
    const [, y, m, d, h, min, sec] = iso;
    return new Date(+y, +m - 1, +d, +h, +min, sec ? +sec : 0);
  }

  const legacy = s.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (legacy) {
    const [, d, m, y, h, min, sec] = legacy;
    return new Date(+y, +m - 1, +d, +h, +min, sec ? +sec : 0);
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

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
  { header: "Tipo Leilão", key: "X", width: 18 },
  { header: "Removido Em", key: "Y", width: 22 },
] as const;

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

function recordToRowArray(record: PropertyRecord, includeRemoved: boolean): (string | number)[] {
  
  const base: (string | number)[] = [
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
    record.auctionType ?? "",
  ];

  base.push(includeRemoved ? formatDate(record.removedAt) : "");
  
  return base;
}

export class ExcelService {
  public filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || config.excelPath;
  }

  async readProperties(): Promise<Map<string, PropertyRecord>> {
    const map = new Map<string, PropertyRecord>();

    if (!fs.existsSync(this.filePath)) {
      logger.info("Excel DB does not exist, will be created on first run");
      return map;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath);
    let sheet = workbook.getWorksheet("Propriedades");
    if (!sheet) {
      const oldSheet = workbook.getWorksheet("Properties");
      if (!oldSheet) return map;
      sheet = oldSheet;
    }

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
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
        publishedAt: parseExcelDate(values[19]),
        firstSeenAt: parseExcelDate(values[20]) ?? new Date(),
        lastSeenAt: parseExcelDate(values[21]) ?? new Date(),
        key: values[22],
        externalId: values[23],
        auctionType: values[24] ?? undefined,
        removedAt: parseExcelDate(values[25]),
      };
      map.set(record.key, record);
    });

    logger.info(`Excel DB: ${map.size} properties loaded`);
    return map;
  }

  async writeResults(
    allRecords: PropertyRecord[],
    diffs: PropertyDiff[],
    historyEntries: HistoryEntry[],
    isFirstRun: boolean
  ): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(this.filePath)) {
      await workbook.xlsx.readFile(this.filePath);
    }

    const oldNewSheet = workbook.getWorksheet("New");
    if (oldNewSheet) workbook.removeWorksheet(oldNewSheet.id);

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
      const row = propSheet!.addRow(recordToRowArray(record, true));
      const diff = diffMap.get(record.key);
      if (diff) {
        this.applyHighlight(row, diff.changeType);
      }
    });

    let newSheet = workbook.getWorksheet("Novos");
    if (newSheet) workbook.removeWorksheet(newSheet.id);
    newSheet = workbook.addWorksheet("Novos");
    PROPERTY_COLUMNS.forEach((col) => {
      newSheet!.getColumn(col.key).width = col.width;
    });
    const newHeader = newSheet.addRow(PROPERTY_COLUMNS.map((c) => c.header));
    newHeader.font = { bold: true };

    const newDiffs = diffs.filter((d) => d.changeType === "NEW");
    if (!isFirstRun) {
      newDiffs.forEach((d) => {
        const row = newSheet!.addRow(recordToRowArray(d.record, false));
        this.applyHighlight(row, "NEW");
      });
    }

    let histSheet = workbook.getWorksheet("Histórico");
    if (!histSheet) {
      histSheet = workbook.addWorksheet("Histórico");
      PROPERTY_COLUMNS.forEach((col) => {
        histSheet!.getColumn(col.key).width = col.width;
      });
      const histHeader = histSheet.addRow(PROPERTY_COLUMNS.map((c) => c.header));
      histHeader.font = { bold: true };
    }

    const recordByKey = new Map(allRecords.map((r) => [r.key, r]));
    historyEntries.forEach((entry) => {
      const record = recordByKey.get(entry.key);
      if (!record) return;

      const row = histSheet!.addRow(recordToRowArray(record, false));
      row.getCell(26).value = entry.event;
      row.getCell(27).value = entry.detail;
    });

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
