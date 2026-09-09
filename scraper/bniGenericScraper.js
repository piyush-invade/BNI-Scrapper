/**
 * bniGenericScraper.js
 * Generic, site-agnostic scraping orchestrator. This is the default
 * "adapter" used for any BNI chapter website. If a particular site's
 * markup is too different for the generic heuristics, add a new file
 * under scraper/adapters/ that exports the same interface
 * ({ detectChapter, discoverAndExtract }) and register it in
 * scraper/adapters/index.js (kept intentionally simple — not created
 * until actually needed for a second site).
 */
(function (global) {
  const { politeDelay, todayISO } = global.BNIHelpers;

  async function run({ onLog, onProgress, shouldStop, enrichFromProfiles = false, maxProfileVisits = 0 } = {}) {
    const log = (msg) => { if (global.BNILogger) global.BNILogger.info(msg); if (onLog) onLog(msg); };

    log('Detecting chapter...');
    const chapterInfo = global.BNIChapterDetector.detect();

    if (!chapterInfo.supported) {
      // Don't bail out here — different regional BNI sites use wildly
      // different URL patterns and page copy, so this heuristic is only a
      // best-effort guess. Log it as a warning and try discovery anyway;
      // if discovery genuinely finds nothing, THAT'S the real signal this
      // isn't a member-list page (handled below).
      log('This page did not match known member-list URL/text patterns — attempting anyway...');
    }

    log('Finding members...');
    const cardElements = await global.BNIMemberDiscovery.discoverAllMembers({
      onProgress: (count) => { if (onProgress) onProgress({ phase: 'discovery', count }); },
      shouldStop
    });

    if (cardElements.length === 0) {
      throw new Error('Could not detect any members on this page. Make sure you are on the public BNI Member List page.');
    }

    log(`${cardElements.length} members found.`);
    log('Collecting member profiles...');

    const rawRecords = [];
    for (let i = 0; i < cardElements.length; i++) {
      if (shouldStop && shouldStop()) {
        log('Stopped by user.');
        break;
      }
      let record;
      try {
        record = global.BNIMemberExtractor.extractMemberCard(cardElements[i]);
      } catch (e) {
        if (global.BNILogger) global.BNILogger.error(`Failed to extract a member card: ${e.message}`);
        continue;
      }

      record.chapterName = chapterInfo.chapterName;
      record.chapterId = chapterInfo.chapterId;
      record.region = chapterInfo.regionId;
      record.chapterUrl = chapterInfo.chapterUrl;
      record.sourceUrl = chapterInfo.sourceUrl;
      record.scrapedAt = new Date().toISOString();

      rawRecords.push(record);
      if (onProgress) onProgress({ phase: 'extraction', current: i + 1, total: cardElements.length });
      if ((i + 1) % 5 === 0 || i === cardElements.length - 1) {
        log(`${i + 1} / ${cardElements.length}`);
      }
    }

    let records = global.BNIDedup.dedupe(rawRecords);

    // Repair any records whose fields got glued together into a single
    // blob by the raw-text extraction fallback (see blobFieldParser.js).
    if (global.BNIBlobFieldParser) {
      const before = records.filter((r) => global.BNIBlobFieldParser.isUnsplitBlob(r)).length;
      if (before > 0) {
        log(`Splitting ${before} record(s) whose fields were merged into one — extracting company/category...`);
        records = global.BNIBlobFieldParser.repairBlobRecords(records);
      }
    }

    if (enrichFromProfiles && maxProfileVisits > 0) {
      log('Enriching records from public profile pages...');
      let visited = 0;
      for (const record of records) {
        if (shouldStop && shouldStop()) break;
        if (visited >= maxProfileVisits) break;
        if (!record.profileUrl) continue;
        visited++;
        const extra = await global.BNIProfileExtractor.fetchPublicProfileData(record.profileUrl);
        if (extra) {
          for (const key of Object.keys(extra)) {
            if (!record[key] && extra[key]) record[key] = extra[key];
          }
        }
        await politeDelay(600, 400);
      }
    }

    // Strip internal debug-only fields before returning the "final" set,
    // but keep them accessible separately for Debug Mode.
    const debugInfo = {
      chapterInfo,
      cardSelectorUsed: global.BNIMemberDiscovery.findMemberCardContainer().selector,
      memberSectionScopeFound: !!global.BNIMemberDiscovery.getMemberSectionScope(),
      memberCardsFound: cardElements.length,
      recordsAfterDedupe: records.length,
      loadMoreDetected: !!global.BNIMemberDiscovery.findLoadMoreButton(),
      paginationDetected: !!global.BNIMemberDiscovery.findPaginationNextButton()
    };

    const cleanRecords = records.map(({ _rawTextDebug, ...rest }) => rest);

    log(`Completed. ${cleanRecords.length} records collected.`);

    return {
      chapterInfo,
      records: cleanRecords,
      debugInfo,
      scrapeDate: todayISO()
    };
  }

  global.BNIGenericScraper = { run };
})(typeof window !== 'undefined' ? window : this);
