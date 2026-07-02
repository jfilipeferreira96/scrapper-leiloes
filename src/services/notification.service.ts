import type { PropertyDiff } from "../models/property.js";
import { logger } from "../utils/logger.js";

/**
 * Prints a readable summary to the console and returns the counts.
 */
export function printSummary(diffs: PropertyDiff[]): {
  new: number;
  priceChange: number;
  statusChange: number;
  removed: number;
  unchanged: number;
} {
  const counts = {
    new: diffs.filter((d) => d.changeType === "NEW").length,
    priceChange: diffs.filter((d) => d.changeType === "PRICE_CHANGE").length,
    statusChange: diffs.filter((d) => d.changeType === "STATUS_CHANGE").length,
    removed: diffs.filter((d) => d.changeType === "REMOVED").length,
    unchanged: diffs.filter((d) => d.changeType === "UNCHANGED").length,
  };

  console.log("\n" + "=".repeat(50));
  console.log("  EXECUTION SUMMARY");
  console.log("=".repeat(50));
  console.log(`  🟢 New properties:          ${counts.new}`);
  console.log(`  🟡 Price changes:           ${counts.priceChange}`);
  console.log(`  🔵 Status changes:          ${counts.statusChange}`);
  console.log(`  🔴 Removed:                 ${counts.removed}`);
  console.log(`  ⚪ Unchanged:               ${counts.unchanged}`);
  console.log("=".repeat(50) + "\n");

  // List new properties
  const newProps = diffs.filter((d) => d.changeType === "NEW");
  if (newProps.length > 0) {
    logger.info("NEW PROPERTIES DETECTED:");
    newProps.forEach((d) => {
      console.log(
        `  → [${d.record.source}] ${d.record.title} | ${d.record.price}€ | ${d.record.location}`
      );
      console.log(`    ${d.record.url}`);
    });
  }

  return counts;
}
