/**
 * content.js
 * Entry point injected into the active tab (on-demand, via
 * chrome.scripting.executeScript triggered from the popup — never
 * automatically on page load). Listens for messages from the popup and
 * drives detection / scraping / stop.
 */
(function () {
  if (window.__BNI_SCRAPER_CONTENT_LOADED__) {
    // Already injected once this page session; avoid double-registering
    // listeners if the popup re-injects.
    return;
  }
  window.__BNI_SCRAPER_CONTENT_LOADED__ = true;

  let stopRequested = false;
  let scraping = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'BNI_PING') {
      sendResponse({ ok: true });
      return true;
    }

    // Fast, synchronous-ish check used by the background script to figure
    // out which frame (top document vs. an embedded iframe widget) is the
    // one that actually holds the member roster. Deliberately does NOT
    // run the full click/scroll discovery loop — just a single snapshot
    // of whatever member-card-shaped elements already exist right now.
    if (message.type === 'BNI_QUICK_SCAN') {
      try {
        const found = window.BNIMemberDiscovery.findMemberCardContainer();
        sendResponse({ ok: true, data: { count: found.nodes.length, selector: found.selector } });
      } catch (e) {
        sendResponse({ ok: true, data: { count: 0, selector: null } });
      }
      return true;
    }

    if (message.type === 'BNI_DETECT_CHAPTER') {
      try {
        const info = window.BNIChapterDetector.detect();
        sendResponse({ ok: true, data: info });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (message.type === 'BNI_START_SCRAPE') {
      if (scraping) {
        sendResponse({ ok: false, error: 'A scrape is already in progress on this page.' });
        return true;
      }
      stopRequested = false;
      scraping = true;

      const options = message.options || {};
      window.BNIGenericScraper.run({
        onProgress: (progress) => {
          try {
            chrome.runtime.sendMessage({ type: 'BNI_PROGRESS', payload: progress }).catch(() => {});
          } catch (e) { /* ignore */ }
        },
        shouldStop: () => stopRequested,
        enrichFromProfiles: !!options.enrichFromProfiles,
        maxProfileVisits: options.maxProfileVisits || 0
      })
        .then((result) => {
          scraping = false;
          sendResponse({ ok: true, data: result });
        })
        .catch((err) => {
          scraping = false;
          if (window.BNILogger) window.BNILogger.error(err.message);
          sendResponse({ ok: false, error: err.message });
        });

      return true; // keep the message channel open for the async response
    }

    if (message.type === 'BNI_STOP_SCRAPE') {
      stopRequested = true;
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'BNI_GET_LOG_BUFFER') {
      sendResponse({ ok: true, data: window.BNILogger ? window.BNILogger.getBuffer() : [] });
      return true;
    }
  });

  if (window.BNILogger) {
    window.BNILogger.info('Content script ready.');
  }
})();
