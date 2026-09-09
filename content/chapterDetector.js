/**
 * chapterDetector.js
 * Attempts to identify the current chapter using multiple independent
 * strategies, since different BNI regional sites use different URL
 * structures and page layouts. Strategies are combined; the first
 * non-empty value found for each field wins, in priority order.
 */
(function (global) {
  const { cleanText, getQueryParams, firstMatchFromParams } = global.BNIHelpers;

  function isLikelyMemberListPage() {
    const url = window.location.href.toLowerCase();
    if (/member[-_]?list|memberdirectory|member[-_]?directory|chapterdetail|chapter[-_]?detail|roster/.test(url)) return true;

    // Fallback: does the page contain what looks like a member roster?
    const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
    if (/member list|chapter members|our members|meet our members|chapter roster|member directory/.test(bodyText)) return true;

    return false;
  }

  function detectFromUrlParams() {
    const params = getQueryParams(window.location.href);
    const chapterId = firstMatchFromParams(params, ['chapterName', 'chapterId', 'chapter_id', 'chapterID']);
    const regionId = firstMatchFromParams(params, ['regionIds', 'regionId', 'region_id', 'regionID']);
    return { chapterId, regionId };
  }

  function detectFromUrlPath() {
    // e.g. https://bni-jaipursouth.in/jaipur-south-bni--onyx/en-IN/memberlist
    // The path segment right after the host often encodes region + chapter
    // slug, e.g. "jaipur-south-bni--onyx".
    const segments = window.location.pathname.split('/').filter(Boolean);
    let chapterSlug = '';
    if (segments.length > 0) {
      // Prefer a segment containing a double-dash, common BNI slug pattern
      const withDoubleDash = segments.find((s) => s.includes('--'));
      chapterSlug = withDoubleDash || segments[0];
    }

    let chapterName = '';
    if (chapterSlug) {
      const parts = chapterSlug.split('--');
      const raw = parts.length > 1 ? parts[parts.length - 1] : chapterSlug;
      chapterName = raw.replace(/[-_]+/g, ' ').trim();
    }
    return { chapterName, chapterSlug };
  }

  function detectFromMetadata() {
    let chapterName = '';

    const og = document.querySelector('meta[property="og:site_name"]');
    if (og && og.content) {
      chapterName = cleanText(og.content);
    }

    if (!chapterName) {
      const titleTag = document.querySelector('title');
      if (titleTag && titleTag.textContent) {
        // Titles are often "Chapter Members | BNI ONYX" or similar
        const parts = titleTag.textContent.split('|').map((s) => s.trim());
        chapterName = parts.find((p) => p && !/member/i.test(p)) || '';
      }
    }

    // Strip a leading "BNI" brand prefix if present, e.g. "BNI  ONYX" -> "ONYX"
    if (chapterName) {
      chapterName = chapterName.replace(/^bni\s+/i, '').trim();
    }

    return { chapterName };
  }

  function detectFromDom() {
    let chapterName = '';
    // Common places a chapter brand/name shows up in the header/nav
    const candidates = [
      'header .navbar-brand',
      '.chapter-name',
      '.chapterName',
      'h1',
      '.site-title',
      'a.navbar-brand'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const text = cleanText(el.textContent);
        if (text && text.length < 80 && !/member list/i.test(text)) {
          chapterName = text.replace(/^bni\s+/i, '').trim();
          if (chapterName) break;
        }
      }
    }
    return { chapterName };
  }

  function detect() {
    const supported = isLikelyMemberListPage();

    const fromParams = detectFromUrlParams();
    const fromPath = detectFromUrlPath();
    const fromMeta = detectFromMetadata();
    const fromDom = detectFromDom();

    const chapterId = fromParams.chapterId || '';
    const regionId = fromParams.regionId || '';

    const chapterName =
      fromMeta.chapterName ||
      fromDom.chapterName ||
      fromPath.chapterName ||
      '';

    const result = {
      supported,
      chapterId,
      regionId,
      chapterName: chapterName || 'Unknown',
      chapterSlug: fromPath.chapterSlug || '',
      sourceUrl: window.location.href,
      chapterUrl: window.location.origin + window.location.pathname,
      detectionDetails: { fromParams, fromPath, fromMeta, fromDom }
    };

    if (global.BNILogger) {
      global.BNILogger.info(
        supported
          ? `Chapter detected: ${result.chapterName}${chapterId ? ' (ID ' + chapterId + ')' : ''}`
          : 'This page does not look like a supported BNI member-list page.'
      );
    }

    return result;
  }

  global.BNIChapterDetector = { detect, isLikelyMemberListPage };
})(typeof window !== 'undefined' ? window : this);
