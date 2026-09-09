/**
 * logger.js
 * Lightweight logger used by content-script modules. Buffers log lines in
 * memory and forwards them to the popup (if listening) via chrome.runtime
 * messages, so the popup's live "Scraping Log" section stays in sync even
 * though the actual scraping runs inside the page's content script context.
 */
(function (global) {
  const buffer = [];
  const MAX_BUFFER = 500;

  function timestamp() {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
  }

  function push(level, message) {
    const line = { level, message, time: timestamp() };
    buffer.push(line);
    if (buffer.length > MAX_BUFFER) buffer.shift();

    // Best-effort forward to popup. If no popup is open this simply fails
    // silently (chrome.runtime.sendMessage rejects with "Receiving end
    // does not exist"), which is expected and fine.
    try {
      chrome.runtime.sendMessage({ type: 'BNI_LOG', payload: line }).catch(() => {});
    } catch (e) {
      // extension context may be invalidated between reloads; ignore
    }

    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[BNI Scraper] ${message}`);
  }

  const Logger = {
    info(message) { push('info', message); },
    warn(message) { push('warn', message); },
    error(message) { push('error', message); },
    debug(message) { push('debug', message); },
    getBuffer() { return buffer.slice(); },
    clear() { buffer.length = 0; }
  };

  global.BNILogger = Logger;
})(typeof window !== 'undefined' ? window : this);
