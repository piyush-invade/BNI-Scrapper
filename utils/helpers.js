/**
 * helpers.js
 * Small, dependency-free utility functions shared across the content-script
 * scraping modules.
 */
(function (global) {

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Random-ish jitter added to delays so the extension doesn't hammer the
  // page with perfectly uniform, bot-like timing.
  function politeDelay(baseMs = 500, jitterMs = 300) {
    const ms = baseMs + Math.floor(Math.random() * jitterMs);
    return delay(ms);
  }

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  }

  function absoluteUrl(href, base) {
    if (!href) return '';
    try {
      return new URL(href, base || window.location.href).href;
    } catch (e) {
      return href;
    }
  }

  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;

  function extractEmail(text) {
    if (!text) return '';
    const m = text.match(EMAIL_RE);
    return m ? m[0] : '';
  }

  function extractPhone(text) {
    if (!text) return '';
    const m = text.match(PHONE_RE);
    return m ? cleanText(m[0]) : '';
  }

  function getQueryParams(url) {
    try {
      const u = new URL(url);
      const out = {};
      for (const [k, v] of u.searchParams.entries()) {
        out[k] = v;
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  // Extracts a plausible chapter identifier out of the "chapterName" style
  // query param, which on BNI sites is usually a numeric chapter ID despite
  // the misleading param name.
  function firstMatchFromParams(params, keys) {
    for (const key of keys) {
      if (params[key]) return params[key];
    }
    return '';
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function safeFilenamePart(str) {
    return (str || 'Unknown').replace(/[^a-z0-9\-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function waitFor(conditionFn, { timeout = 8000, interval = 200 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let result;
        try { result = conditionFn(); } catch (e) { result = false; }
        if (result) {
          resolve(result);
        } else if (Date.now() - start >= timeout) {
          resolve(false);
        } else {
          setTimeout(tick, interval);
        }
      };
      tick();
    });
  }

  global.BNIHelpers = {
    delay,
    politeDelay,
    cleanText,
    absoluteUrl,
    extractEmail,
    extractPhone,
    getQueryParams,
    firstMatchFromParams,
    todayISO,
    safeFilenamePart,
    waitFor
  };
})(typeof window !== 'undefined' ? window : this);
