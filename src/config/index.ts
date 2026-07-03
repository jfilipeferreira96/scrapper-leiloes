import * as dotenv from "dotenv";
dotenv.config();

export const config = {
  excelPath: process.env.EXCEL_PATH || "./data/properties.xlsx",
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || "30000", 10),
  activeScrapers: (process.env.ACTIVE_SCRAPERS || "")
    .split(",")
    .map((s) => s.trim()),
  // Filter properties by location. Set to true to enable location-based filtering.
  // Default: false (bring all properties) for testing purposes.
  filterByLocation: process.env.FILTER_BY_LOCATION === "true",
};