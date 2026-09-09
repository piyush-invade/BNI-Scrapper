/**
 * deduplication.js
 * Deduplicates member records using, in priority order:
 *   1. Member ID
 *   2. Profile URL
 *   3. Normalized (Member Name + Company Name + Chapter ID)
 */
(function (global) {

  function normalize(str) {
    return (str || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function recordKey(record) {
    if (record.memberId) return `mid:${normalize(record.memberId)}`;
    if (record.profileUrl) return `url:${normalize(record.profileUrl)}`;
    return `combo:${normalize(record.memberName)}|${normalize(record.companyName)}|${normalize(record.chapterId)}`;
  }

  // Merge two records for the same logical member, preferring non-empty
  // values and the most recently scraped data for anything that changed.
  function mergeRecords(existing, incoming) {
    const merged = { ...existing };
    for (const key of Object.keys(incoming)) {
      if (key === 'scrapedAt') continue;
      const incomingVal = incoming[key];
      const existingVal = existing[key];
      if ((existingVal === undefined || existingVal === null || existingVal === '') &&
          incomingVal !== undefined && incomingVal !== null && incomingVal !== '') {
        merged[key] = incomingVal;
      }
    }
    // always keep the latest scrape timestamp
    if (incoming.scrapedAt) merged.scrapedAt = incoming.scrapedAt;
    return merged;
  }

  function dedupe(records) {
    const map = new Map();
    for (const record of records) {
      const key = recordKey(record);
      if (map.has(key)) {
        map.set(key, mergeRecords(map.get(key), record));
      } else {
        map.set(key, { ...record });
      }
    }
    return Array.from(map.values());
  }

  // Merge a batch of newly scraped records into an existing dataset
  // (used for "Append to Master Dataset" mode).
  function mergeIntoDataset(existingRecords, newRecords) {
    const combined = dedupe([...existingRecords, ...newRecords]);
    return combined;
  }

  global.BNIDedup = {
    recordKey,
    mergeRecords,
    dedupe,
    mergeIntoDataset
  };
})(typeof window !== 'undefined' ? window : this);
