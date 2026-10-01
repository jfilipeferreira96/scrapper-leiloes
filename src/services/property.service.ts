import type {
  Property,
  PropertyRecord,
  PropertyDiff,
  ChangeType,
} from "../models/property.js";
import { propertyKey } from "../models/property.js";
import type { HistoryEntry } from "../database/excel.service.js";
import { logger } from "../utils/logger.js";

export function diffProperties(
  scraped: Property[],
  existing: Map<string, PropertyRecord>,
  succeededSources: Set<string>
): {
  diffs: PropertyDiff[];
  updatedRecords: PropertyRecord[];
  history: HistoryEntry[];
} {
  const now = new Date();
  const diffs: PropertyDiff[] = [];
  const updatedRecords: PropertyRecord[] = [];
  const history: HistoryEntry[] = [];
  const seenKeys = new Set<string>();

  for (const prop of scraped) {
    const key = propertyKey(prop.source, prop.externalId);
    seenKeys.add(key);
    const existingRec = existing.get(key);

    if (!existingRec) {
      const newRecord: PropertyRecord = {
        ...prop,
        key,
        firstSeenAt: now,
        lastSeenAt: now,
      };
      updatedRecords.push(newRecord);
      diffs.push({ record: newRecord, changeType: "NEW" });
      history.push({
        timestamp: now.toISOString(),
        key,
        event: "NEW",
        detail: `Price: ${prop.price}`,
        source: prop.source,
      });
    } else {
      const priceChanged = existingRec.price !== prop.price;
      const statusChanged =
        existingRec.status !== prop.status && prop.status !== undefined;

      const updatedRec: PropertyRecord = {
        ...existingRec,
        ...prop,
        key,
        previousPrice: priceChanged ? existingRec.price : existingRec.previousPrice,
        lastSeenAt: now,
        removedAt: undefined,
      };
      updatedRecords.push(updatedRec);

      let changeType: ChangeType = "UNCHANGED";
      if (priceChanged) {
        changeType = "PRICE_CHANGE";
        history.push({
          timestamp: now.toISOString(),
          key,
          event: "PRICE_CHANGE",
          detail: `${existingRec.price} -> ${prop.price}`,
          source: prop.source,
        });
      } else if (statusChanged) {
        changeType = "STATUS_CHANGE";
        history.push({
          timestamp: now.toISOString(),
          key,
          event: "STATUS_CHANGE",
          detail: `${existingRec.status} -> ${prop.status}`,
          source: prop.source,
        });
      }

      diffs.push({
        record: updatedRec,
        changeType,
        previousPrice: priceChanged ? existingRec.price : undefined,
        previousStatus: statusChanged ? existingRec.status : undefined,
      });
    }
  }

  for (const [key, rec] of existing) {
    if (seenKeys.has(key)) continue;

    const sourceOk = succeededSources.has(rec.source);
    const alreadyRemoved = rec.removedAt !== undefined;
    if (!sourceOk || alreadyRemoved) {
      updatedRecords.push(rec);
      continue;
    }

    const removedRec: PropertyRecord = { ...rec, removedAt: now };
    updatedRecords.push(removedRec);
    diffs.push({ record: removedRec, changeType: "REMOVED" });
    history.push({
      timestamp: now.toISOString(),
      key,
      event: "REMOVED",
      detail: `Not found in latest scrape`,
      source: rec.source,
    });
  }

  const summary = {
    new: diffs.filter((d) => d.changeType === "NEW").length,
    priceChange: diffs.filter((d) => d.changeType === "PRICE_CHANGE").length,
    statusChange: diffs.filter((d) => d.changeType === "STATUS_CHANGE").length,
    removed: diffs.filter((d) => d.changeType === "REMOVED").length,
    unchanged: diffs.filter((d) => d.changeType === "UNCHANGED").length,
  };

  logger.info("Diff completed:", summary);

  return { diffs, updatedRecords, history };
}
