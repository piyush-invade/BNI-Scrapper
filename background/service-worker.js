/**
 * service-worker.js
 * Manifest V3 background service worker.
 *
 * Responsibilities:
 *  1. Inject the content-script bundle into the active tab on demand
 *     (only ever triggered by an explicit popup action — never
 *     automatically) via chrome.scripting.executeScript.
 *  2. Handle BNI_FETCH_PROFILE requests: open a member's public profile
 *     URL in a new background tab, extract publicly visible fields, then
 *     close the tab. No credentials are ever supplied and no login flow
 *     is touched — this only reads whatever a normal unauthenticated
 *     visitor would see.
 */

const CONTENT_FILES = [
  'utils/logger.js',
  'utils/helpers.js',
  'utils/deduplication.js',
  'utils/blobFieldParser.js',
  'content/chapterDetector.js',
  'content/memberDiscovery.js',
  'content/memberExtractor.js',
  'content/profileExtractor.js',
  'scraper/bniGenericScraper.js',
  'content/content.js'
];

async function ensureContentInjected(tabId) {
  // Cheap way to check if content.js already registered itself in the top
  // frame: ping it there specifically (frameId 0 is always the top frame).
  const alreadyThere = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'BNI_PING' }, { frameId: 0 }, (resp) => {
      resolve(!chrome.runtime.lastError && resp && resp.ok);
    });
  });
  if (alreadyThere) return;

  // allFrames: true so the content script also registers inside any
  // same-origin iframes the page uses (several BNI chapter sites embed
  // their member roster via an iframe'd directory widget rather than
  // rendering it directly in the top document — without this, every DOM
  // query in memberDiscovery.js only ever sees the empty page shell).
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES
  });
}

// Enumerate every frame in the tab and ask each one (via a fast, one-shot
// scan — not the full click/scroll discovery loop) how many plausible
// member-card elements it can see. Returns the frameId with the best
// signal, defaulting to the top frame (0) if nothing beats it or frame
// enumeration/messaging fails for any reason (e.g. a cross-origin iframe
// that never receives the injected script at all).
async function findBestFrame(tabId) {
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    return 0;
  }
  if (!frames || frames.length === 0) return 0;

  const scans = await Promise.all(
    frames.map(
      (f) =>
        new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'BNI_QUICK_SCAN' }, { frameId: f.frameId }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) {
              resolve({ frameId: f.frameId, count: -1 });
            } else {
              resolve({ frameId: f.frameId, count: resp.data.count });
            }
          });
        })
    )
  );

  const best = scans.reduce((a, b) => (b.count > a.count ? b : a), { frameId: 0, count: -1 });
  return best.count > 0 ? best.frameId : 0;
}

// This function is executed inside the newly opened profile tab. It must be
// self-contained (no outer closure references) since it's passed to
// chrome.scripting.executeScript as `func`.
function extractProfileFieldsInPage() {
  function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
  function textFromSelectors(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = clean(el.textContent);
        if (t) return t;
      }
    }
    return '';
  }
  const bodyText = document.body ? document.body.innerText : '';
  const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = bodyText.match(/(\+?\d[\d\s().-]{6,}\d)/);
  const websiteLink = Array.from(document.querySelectorAll('a[href^="http"]'))
    .map((a) => a.href)
    .find((href) => !href.includes(location.hostname) && /\.(com|in|net|org|co)\b/i.test(href));

  return {
    companyName: textFromSelectors(['.company', '.company-name', '.companyName', '.business-name']),
    profession: textFromSelectors(['.profession', '.category', '.designation', '.business-category']),
    address: textFromSelectors(['.address', '.member-address', '.location']),
    city: textFromSelectors(['.city']),
    state: textFromSelectors(['.state']),
    country: textFromSelectors(['.country']),
    website: websiteLink || '',
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneMatch ? clean(phoneMatch[0]) : ''
  };
}

async function fetchPublicProfile(profileUrl) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: profileUrl, active: false });

    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // safety timeout in case "complete" never fires
      setTimeout(resolve, 9000);
    });

    // brief settle time for any client-side rendering
    await new Promise((r) => setTimeout(r, 600));

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProfileFieldsInPage
    });

    const data = results && results[0] ? results[0].result : null;
    return data;
  } catch (e) {
    return null;
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) { /* already closed */ }
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'BNI_INJECT_CONTENT') {
    const tabId = message.tabId;
    ensureContentInjected(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Asks every frame in the tab which one actually has member-card-shaped
  // content, so the popup can target that specific frame for detection
  // and scraping instead of assuming it's always the top-level document.
  if (message.type === 'BNI_FIND_BEST_FRAME') {
    const tabId = message.tabId;
    findBestFrame(tabId)
      .then((frameId) => sendResponse({ ok: true, frameId }))
      .catch((err) => sendResponse({ ok: false, error: err.message, frameId: 0 }));
    return true;
  }

  if (message.type === 'BNI_FETCH_PROFILE') {
    fetchPublicProfile(message.profileUrl)
      .then((data) => sendResponse({ ok: !!data, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // BNI_LOG and BNI_PROGRESS messages are simply relayed/observed by the
  // popup directly (popup registers its own onMessage listener while
  // open); the service worker doesn't need to do anything with them.
});
