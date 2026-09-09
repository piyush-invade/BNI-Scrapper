/**
 * popup.js
 * Drives the popup UI. Talks to the background service worker to inject
 * content scripts into the active tab (only when the user clicks a
 * button — never automatically), and to content.js to run detection /
 * scraping. Persists results via storage.js and exports via
 * excelExporter.js.
 */

let currentTabId = null;
let currentFrameId = 0;
let currentChapterInfo = null;
let currentRecords = [];
let currentDebugInfo = null;
let scraping = false;

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  $(id).textContent = (value === undefined || value === null || value === '') ? '—' : value;
}

function appendLogLine(line) {
  const box = $('logBox');
  const div = document.createElement('div');
  div.className = `log-line ${line.level || 'info'}`;
  div.textContent = `[${line.time || ''}] ${line.message || ''}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  $('logBox').innerHTML = '';
}

function setButtonsDuringScrape(isScraping) {
  scraping = isScraping;
  $('btnScrape').disabled = isScraping;
  $('btnDetect').disabled = isScraping;
  $('btnStop').disabled = !isScraping;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => resolve(resp));
  });
}

function sendToTab(tabId, message, frameId) {
  return new Promise((resolve) => {
    const options = frameId === undefined ? undefined : { frameId };
    const callback = (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp);
      }
    };
    if (options) {
      chrome.tabs.sendMessage(tabId, message, options, callback);
    } else {
      chrome.tabs.sendMessage(tabId, message, callback);
    }
  });
}

async function ensureInjected(tabId) {
  const res = await sendToBackground({ type: 'BNI_INJECT_CONTENT', tabId });
  if (!res || !res.ok) return false;

  // Figure out which frame (top document, or an embedded iframe widget)
  // actually contains the member roster, so detection/scraping targets
  // the right document instead of assuming it's always the top frame.
  const frameRes = await sendToBackground({ type: 'BNI_FIND_BEST_FRAME', tabId });
  currentFrameId = frameRes && frameRes.ok ? frameRes.frameId : 0;
  return true;
}

async function refreshCurrentPageInfo() {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
    setText('currentUrl', tab ? tab.url : 'No active tab');
    appendLogLine({ level: 'warn', message: 'This page cannot be scraped (unsupported URL scheme).' });
    return;
  }
  currentTabId = tab.id;
  currentFrameId = 0;
  setText('currentUrl', tab.url);
}

async function handleDetectChapter() {
  clearLog();
  appendLogLine({ level: 'info', message: 'Detecting chapter...' });
  await refreshCurrentPageInfo();
  if (!currentTabId) return;

  const injected = await ensureInjected(currentTabId);
  if (!injected) {
    appendLogLine({ level: 'error', message: 'Could not access this page. Make sure it is a normal http(s) page.' });
    return;
  }

  const resp = await sendToTab(currentTabId, { type: 'BNI_DETECT_CHAPTER' }, currentFrameId);
  if (!resp || !resp.ok) {
    appendLogLine({ level: 'error', message: (resp && resp.error) || 'Detection failed.' });
    return;
  }

  currentChapterInfo = resp.data;
  setText('chapterName', currentChapterInfo.chapterName);
  setText('chapterId', currentChapterInfo.chapterId);
  setText('regionId', currentChapterInfo.regionId);

  if (!currentChapterInfo.supported) {
    appendLogLine({ level: 'warn', message: 'Could not detect any members on this page. Make sure you are on the public BNI Member List page.' });
  } else {
    appendLogLine({ level: 'info', message: `Chapter detected: ${currentChapterInfo.chapterName}` });
  }

  renderDebugInfo();
}

async function handleScrape() {
  await refreshCurrentPageInfo();
  if (!currentTabId) return;

  clearLog();
  currentRecords = [];
  setButtonsDuringScrape(true);
  appendLogLine({ level: 'info', message: 'Detecting chapter...' });

  const injected = await ensureInjected(currentTabId);
  if (!injected) {
    appendLogLine({ level: 'error', message: 'Could not access this page.' });
    setButtonsDuringScrape(false);
    return;
  }

  const settings = await window.BNIStorage.getSettings();

  const resp = await sendToTab(
    currentTabId,
    {
      type: 'BNI_START_SCRAPE',
      options: {
        enrichFromProfiles: settings.enrichFromProfiles,
        maxProfileVisits: settings.maxProfileVisits || 0
      }
    },
    currentFrameId
  );

  setButtonsDuringScrape(false);

  if (!resp || !resp.ok) {
    appendLogLine({ level: 'error', message: (resp && resp.error) || 'Scrape failed for an unknown reason.' });
    return;
  }

  const { chapterInfo, records, debugInfo } = resp.data;
  currentChapterInfo = chapterInfo;
  currentRecords = records;
  currentDebugInfo = debugInfo;

  setText('chapterName', chapterInfo.chapterName);
  setText('chapterId', chapterInfo.chapterId);
  setText('regionId', chapterInfo.regionId);
  setText('memberCount', records.length);

  renderDebugInfo();
  renderPreview();

  await window.BNIStorage.saveChapterData(chapterInfo.chapterId || chapterInfo.chapterName, records);
  await window.BNIStorage.upsertChapterHistoryEntry({
    chapterId: chapterInfo.chapterId,
    chapterName: chapterInfo.chapterName,
    memberCount: records.length,
    lastScrapedAt: new Date().toISOString().slice(0, 10),
    chapterUrl: chapterInfo.chapterUrl
  });

  if (settings.appendToMaster) {
    await window.BNIStorage.appendToMasterDataset(records);
    appendLogLine({ level: 'info', message: 'Appended to master dataset.' });
  }

  await renderHistoryTable();
}

async function handleStop() {
  if (!currentTabId) return;
  await sendToTab(currentTabId, { type: 'BNI_STOP_SCRAPE' }, currentFrameId);
  appendLogLine({ level: 'warn', message: 'Stop requested. Finishing current step...' });
}

function renderPreview() {
  const panel = $('previewPanel');
  const thead = document.querySelector('#previewTable thead');
  const tbody = document.querySelector('#previewTable tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!currentRecords || currentRecords.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  $('previewCount').textContent = `(${currentRecords.length} records)`;

  const cols = window.BNIExcelExporter.EXPORT_COLUMNS;
  const trHead = document.createElement('tr');
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.header;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  currentRecords.forEach((record) => {
    const tr = document.createElement('tr');
    cols.forEach((c) => {
      const td = document.createElement('td');
      td.textContent = record[c.key] || '';
      td.title = record[c.key] || '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderDebugInfo() {
  const debugOn = $('debugModeToggle').checked;
  $('debugPanel').hidden = !debugOn;
  if (!debugOn) return;

  const info = {
    chapterInfo: currentChapterInfo,
    frameIdUsed: currentFrameId,
    scrapeDebugInfo: currentDebugInfo
  };
  $('debugContent').textContent = JSON.stringify(info, null, 2);
}

async function renderHistoryTable() {
  const history = await window.BNIStorage.getChaptersHistory();
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';

  if (!history || history.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty-note';
    td.textContent = 'No chapters scraped yet.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  history
    .slice()
    .sort((a, b) => (b.lastScrapedAt || '').localeCompare(a.lastScrapedAt || ''))
    .forEach((entry) => {
      const tr = document.createElement('tr');
      [entry.chapterName, entry.chapterId, entry.memberCount, entry.lastScrapedAt].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val === undefined || val === null || val === '' ? '—' : val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
}

async function handleExport(format) {
  if (!currentRecords || currentRecords.length === 0) {
    appendLogLine({ level: 'warn', message: 'No records to export yet. Run a scrape first.' });
    return;
  }
  const chapterName = currentChapterInfo ? currentChapterInfo.chapterName : 'Unknown';
  if (format === 'xlsx') {
    const filename = window.BNIExcelExporter.exportToExcel(currentRecords, { chapterName });
    appendLogLine({ level: 'info', message: `Exported ${filename}` });
  } else {
    const filename = window.BNIExcelExporter.exportToCSV(currentRecords, { chapterName });
    appendLogLine({ level: 'info', message: `Exported ${filename}` });
  }
}

async function handleClear() {
  currentRecords = [];
  setText('memberCount', '');
  renderPreview();
  if (currentChapterInfo) {
    await window.BNIStorage.clearChapterData(currentChapterInfo.chapterId || currentChapterInfo.chapterName);
  }
  appendLogLine({ level: 'info', message: 'Cleared current chapter data (local history untouched).' });
}

function wireSettingsToggles() {
  window.BNIStorage.getSettings().then((settings) => {
    $('debugModeToggle').checked = !!settings.debugMode;
    $('appendToMasterToggle').checked = !!settings.appendToMaster;
    $('debugPanel').hidden = !settings.debugMode;
  });

  $('debugModeToggle').addEventListener('change', async (e) => {
    await window.BNIStorage.saveSettings({ debugMode: e.target.checked });
    renderDebugInfo();
  });

  $('appendToMasterToggle').addEventListener('change', async (e) => {
    await window.BNIStorage.saveSettings({ appendToMaster: e.target.checked });
  });
}

function wireButtons() {
  $('btnDetect').addEventListener('click', handleDetectChapter);
  $('btnScrape').addEventListener('click', handleScrape);
  $('btnStop').addEventListener('click', handleStop);
  $('btnPreview').addEventListener('click', renderPreview);
  $('btnExportExcel').addEventListener('click', () => handleExport('xlsx'));
  $('btnExportCsv').addEventListener('click', () => handleExport('csv'));
  $('btnClear').addEventListener('click', handleClear);
  $('btnCopyDebug').addEventListener('click', async () => {
    const text = $('debugContent').textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      appendLogLine({ level: 'info', message: 'Debug information copied to clipboard.' });
    } catch (e) {
      appendLogLine({ level: 'error', message: 'Could not copy to clipboard.' });
    }
  });
}

function wireRuntimeListeners() {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === 'BNI_LOG') {
      appendLogLine(message.payload);
    } else if (message.type === 'BNI_PROGRESS') {
      const p = message.payload;
      if (p.phase === 'discovery') {
        setText('memberCount', p.count);
      } else if (p.phase === 'extraction') {
        setText('memberCount', p.total);
      }
    }
  });
}

async function init() {
  wireButtons();
  wireRuntimeListeners();
  wireSettingsToggles();
  await refreshCurrentPageInfo();
  await renderHistoryTable();
}

document.addEventListener('DOMContentLoaded', init);
