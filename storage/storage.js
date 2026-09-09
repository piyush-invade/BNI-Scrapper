/**
 * storage.js
 * Thin wrapper around chrome.storage.local. Used by the popup (not the
 * content script) to persist:
 *   - bni_chapters_history: [{ chapterId, chapterName, memberCount, lastScrapedAt, chapterUrl }]
 *   - bni_chapter_data:<chapterId>: full record array for that chapter (latest scrape)
 *   - bni_master_dataset: deduplicated/merged record array across all chapters
 *   - bni_settings: { debugMode, appendToMaster, enrichFromProfiles, maxProfileVisits }
 *
 * No passwords, tokens, or credentials are ever stored here.
 */

const STORAGE_KEYS = {
  CHAPTERS_HISTORY: 'bni_chapters_history',
  CHAPTER_DATA_PREFIX: 'bni_chapter_data_',
  MASTER_DATASET: 'bni_master_dataset',
  SETTINGS: 'bni_settings'
};

function chapterDataKey(chapterId) {
  return `${STORAGE_KEYS.CHAPTER_DATA_PREFIX}${chapterId || 'unknown'}`;
}

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setLocal(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function getSettings() {
  const res = await getLocal({ [STORAGE_KEYS.SETTINGS]: {} });
  return {
    debugMode: false,
    appendToMaster: false,
    enrichFromProfiles: false,
    maxProfileVisits: 0,
    ...res[STORAGE_KEYS.SETTINGS]
  };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await setLocal({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

async function getChaptersHistory() {
  const res = await getLocal({ [STORAGE_KEYS.CHAPTERS_HISTORY]: [] });
  return res[STORAGE_KEYS.CHAPTERS_HISTORY];
}

async function upsertChapterHistoryEntry(entry) {
  const history = await getChaptersHistory();
  const idx = history.findIndex((h) => h.chapterId === entry.chapterId && entry.chapterId);
  const matchByName = idx === -1 ? history.findIndex((h) => h.chapterName === entry.chapterName) : idx;
  const finalIdx = entry.chapterId ? idx : matchByName;

  if (finalIdx >= 0) {
    history[finalIdx] = { ...history[finalIdx], ...entry };
  } else {
    history.push(entry);
  }
  await setLocal({ [STORAGE_KEYS.CHAPTERS_HISTORY]: history });
  return history;
}

async function getChapterData(chapterId) {
  const key = chapterDataKey(chapterId);
  const res = await getLocal({ [key]: [] });
  return res[key];
}

async function saveChapterData(chapterId, records) {
  const key = chapterDataKey(chapterId);
  await setLocal({ [key]: records });
}

async function clearChapterData(chapterId) {
  const key = chapterDataKey(chapterId);
  await setLocal({ [key]: [] });
}

async function getMasterDataset() {
  const res = await getLocal({ [STORAGE_KEYS.MASTER_DATASET]: [] });
  return res[STORAGE_KEYS.MASTER_DATASET];
}

async function saveMasterDataset(records) {
  await setLocal({ [STORAGE_KEYS.MASTER_DATASET]: records });
}

async function appendToMasterDataset(newRecords) {
  const existing = await getMasterDataset();
  const merged = window.BNIDedup.mergeIntoDataset(existing, newRecords);
  await saveMasterDataset(merged);
  return merged;
}

window.BNIStorage = {
  STORAGE_KEYS,
  getSettings,
  saveSettings,
  getChaptersHistory,
  upsertChapterHistoryEntry,
  getChapterData,
  saveChapterData,
  clearChapterData,
  getMasterDataset,
  saveMasterDataset,
  appendToMasterDataset
};
