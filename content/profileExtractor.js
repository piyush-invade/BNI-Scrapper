/**
 * profileExtractor.js
 * Optionally enriches a member record by visiting its publicly accessible
 * profile page. This module never logs in, submits forms, or supplies
 * credentials — it only reads what is already rendered on the public page.
 *
 * Since a content script cannot open a background tab by itself, this
 * module asks the background service worker to open the profile URL in a
 * new (briefly focused-then-closed) tab, inject a lightweight extraction
 * function into it, and return the scraped fields. If that round-trip
 * fails or is disabled, the caller should simply keep the data already
 * collected from the member-list card.
 */
(function (global) {
  const { cleanText, extractEmail, extractPhone } = global.BNIHelpers;

  // This function is serialized and executed inside the *profile page's*
  // context by chrome.scripting.executeScript — it must be self-contained
  // and must not reference anything from the outer closure.
  function extractFromProfileDocument() {
    function clean(t) {
      return (t || '').replace(/\s+/g, ' ').trim();
    }
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

  /**
   * Requests the background service worker to open `profileUrl`, run
   * extractFromProfileDocument() in that tab, and return the result.
   * Resolves to `null` on any failure (timeout, blocked navigation, tab
   * open error) so callers can gracefully fall back.
   */
  function fetchPublicProfileData(profileUrl, { timeoutMs = 12000 } = {}) {
    if (!profileUrl) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      try {
        chrome.runtime.sendMessage(
          { type: 'BNI_FETCH_PROFILE', profileUrl },
          (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError || !response || !response.ok) {
              finish(null);
              return;
            }
            finish(response.data || null);
          }
        );
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  global.BNIProfileExtractor = {
    extractFromProfileDocument, // exported so background.js can stringify/inject it
    fetchPublicProfileData
  };
})(typeof window !== 'undefined' ? window : this);
