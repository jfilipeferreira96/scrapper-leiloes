/**
 * Debug script for OneFix scraper.
 * Tests each step individually with timeouts to identify where it hangs.
 *
 * Usage: npx tsx scripts/debug-onefix.ts
 */

import { CurlHelper } from "../src/utils/curl.js";

const ONEFIX_URL = "https://www.onefix-leiloeiros.pt/tipo_verbas/1/Imoveis";

async function withTimeout<T>(name: string, fn: () => Promise<T>, timeoutMs: number = 20000): Promise<T | null> {
  console.log(`\n[${new Date().toISOString()}] START: ${name}`);
  const start = Date.now();
  
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`TIMEOUT after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
    const elapsed = Date.now() - start;
    console.log(`[${new Date().toISOString()}] SUCCESS: ${name} (${elapsed}ms)`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    console.error(`[${new Date().toISOString()}] FAILED: ${name} (${elapsed}ms) - ${(error as Error).message}`);
    return null;
  }
}

async function main() {
  console.log("=== OneFix Debug Script ===");
  console.log(`[${new Date().toISOString()}] Testing URL: ${ONEFIX_URL}`);

  // Step 1: Test if curl is available
  console.log("\n--- Step 1: Check curl availability ---");
  const curlAvailable = CurlHelper.isAvailable();
  console.log(`Curl available: ${curlAvailable}`);
  if (!curlAvailable) {
    console.error("Curl is not available! Aborting.");
    return;
  }

  // Step 2: Test fetching the listing page with CurlHelper
  console.log("\n--- Step 2: Fetch listing page with CurlHelper ---");
  const html = await withTimeout("CurlHelper.get(ONEFIX_URL)", async () => {
    return CurlHelper.get(ONEFIX_URL);
  }, 20000);

  if (!html) {
    console.error("Failed to fetch listing page. Aborting.");
    return;
  }

  console.log(`HTML length: ${html.length}`);
  console.log(`Contains property_grid: ${html.includes("property_grid")}`);
  console.log(`Contains property-title: ${html.includes("property-title")}`);
  console.log(`Contains pagination: ${html.includes("pagination")}`);

  // Step 3: Test parsing the listing
  console.log("\n--- Step 3: Parse listing ---");
  const { parseOneFixListing } = await import("../src/scrapers/onefix/onefix.parser.js");
  
  const parseResult = await withTimeout("parseOneFixListing(html)", async () => {
    return parseOneFixListing(html);
  }, 10000);

  if (!parseResult) {
    console.error("Failed to parse listing. Aborting.");
    return;
  }

  console.log(`Properties found: ${parseResult.properties.length}`);
  console.log(`Next URL: ${parseResult.nextUrl}`);

  if (parseResult.properties.length > 0) {
    console.log("\nFirst property:");
    console.log(JSON.stringify(parseResult.properties[0], null, 2));
  }

  // Step 4: Test fetching a detail page
  if (parseResult.properties.length > 0) {
    console.log("\n--- Step 4: Fetch detail page ---");
    const detailUrl = parseResult.properties[0].url;
    console.log(`Detail URL: ${detailUrl}`);
    
    const detailHtml = await withTimeout("CurlHelper.get(detailUrl)", async () => {
      return CurlHelper.get(detailUrl);
    }, 20000);

    if (detailHtml) {
      console.log(`Detail HTML length: ${detailHtml.length}`);
      console.log(`Contains property_sidebar: ${detailHtml.includes("property_sidebar")}`);
    }
  }

  console.log("\n=== Debug Complete ===");
}

main().catch(console.error);
