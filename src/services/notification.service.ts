import type { PropertyDiff } from "../models/property.js";

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
  console.log("  RESUMO");
  console.log("=".repeat(50));
  console.log(`  Novos:          ${counts.new}`);
  console.log(`  Preços:         ${counts.priceChange}`);
  console.log(`  Estados:        ${counts.statusChange}`);
  console.log(`  Removidos:      ${counts.removed}`);
  console.log(`  Inalterados:    ${counts.unchanged}`);
  console.log("=".repeat(50) + "\n");

  return counts;
}
