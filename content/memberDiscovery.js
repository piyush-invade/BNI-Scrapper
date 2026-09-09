/**
 * memberDiscovery.js
 * Responsible for locating member-card elements on the page and, where
 * needed, driving pagination / "Load More" / infinite-scroll interactions
 * so that all publicly rendered members become visible in the DOM before
 * extraction runs.
 *
 * This module never submits forms, enters credentials, or bypasses any
 * access control — it only clicks visible, publicly-available "next" /
 * "load more" controls and scrolls the page, exactly as a normal visitor
 * browsing the public page would.
 */
(function (global) {
  const { delay, politeDelay, cleanText, waitFor } = global.BNIHelpers;

  // Candidate selectors for a single member "card" — ordered roughly by
  // specificity. The generic scraper tries each until one yields a
  // plausible set of repeated, similarly-shaped elements.
  const CARD_SELECTOR_CANDIDATES = [
    '.member-card',
    '.memberCard',
    '.member-list-item',
    '.memberlist-item',
    '.member-item',
    '[class*="member"][class*="card"]',
    '[class*="member-list"] li',
    '[class*="memberList"] li',
    '.card:has(a[href*="profile"])',
    'li.member',
    '.profile-card',
    '[data-member-id]',
    // Some chapter sites render the roster as a plain HTML table rather
    // than card divs — a <tr> that contains a profile-ish link is a
    // reasonable stand-in for a "card" in that case.
    'table tr:has(a[href*="profile"])',
    'table tr:has(a[href*="member"])',
    'tbody > tr'
  ];

  const LOAD_MORE_TEXT_RE = /load more|show more|view more|see more/i;
  const NEXT_PAGE_TEXT_RE = /^next$|next page|»|›/i;

  // Container/element patterns that indicate navigation, pagination, or
  // menu widgets rather than content — these must NEVER be picked up by
  // the sibling-heuristic fallback below.
  const NAV_LIKE_RE = /nav|pagination|pager|page-numbers|breadcrumb|menu|footer|header/i;

  // A child that is pure digits, a single character, or "prev"/"next"/"..."
  // is almost certainly a page-number control, not a member card.
  const PAGE_CONTROL_TEXT_RE = /^(\d{1,3}|prev(ious)?|next|\.\.\.|»|«|›|‹)$/i;

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isNavLikeContainer(el) {
    if (!el) return false;
    if (el.closest && el.closest('nav, .pagination, .pager, [role="navigation"]')) return true;
    const cls = (el.className && el.className.toString()) || '';
    const id = el.id || '';
    return NAV_LIKE_RE.test(cls) || NAV_LIKE_RE.test(id);
  }

  function hasMeaningfulText(el) {
    const text = cleanText(el.innerText || el.textContent || '');
    if (!text) return false;
    if (PAGE_CONTROL_TEXT_RE.test(text)) return false;
    // Require at least a plausible "name-length" chunk of text so single
    // page-number links or icon-only buttons never qualify.
    return text.length >= 4;
  }

  // Regex for headings that mark the start of the member roster, and
  // headings for sections that must NEVER be searched for "member cards"
  // (blog/news feeds, galleries, footers, etc. — the exact kind of widget
  // that was mistaken for member data previously).
  const MEMBER_SECTION_HEADING_RE = /member\s*list|chapter\s*members|our\s*members|meet\s*our\s*members/i;
  const EXCLUDED_SECTION_RE = /latest|blog|news|gallery|testimonial|event|footer|sponsor|partner/i;

  function getAllHeadings() {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4'));
  }

  function buildDocumentOrderIndex() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const all = [];
    let node = walker.currentNode;
    while (node) {
      all.push(node);
      node = walker.nextNode();
    }
    return all;
  }

  // Determines the set of elements that belong to the actual "Member List"
  // section, based on the heading text, bounded by the next heading of any
  // kind. Returns null if no such heading can be found (caller should then
  // fall back to a document-wide search that still excludes known
  // non-member sections via isExcludedSection()).
  function getMemberSectionScope() {
    const headings = getAllHeadings();
    const startHeading = headings.find((h) => MEMBER_SECTION_HEADING_RE.test(cleanText(h.textContent)));
    if (!startHeading) return null;

    const startIdx = headings.indexOf(startHeading);
    const stopHeading = headings[startIdx + 1] || null;

    const ordered = buildDocumentOrderIndex();
    const startPos = ordered.indexOf(startHeading);
    const stopPos = stopHeading ? ordered.indexOf(stopHeading) : ordered.length;

    if (startPos === -1) return null;

    const scopeSet = new Set(ordered.slice(startPos + 1, stopPos === -1 ? ordered.length : stopPos));
    return scopeSet;
  }

  function isExcludedSection(el) {
    if (!el) return false;
    if (el.closest) {
      const excluded = el.closest('[class], [id]');
      if (excluded) {
        const cls = (excluded.className && excluded.className.toString()) || '';
        const id = excluded.id || '';
        if (EXCLUDED_SECTION_RE.test(cls) || EXCLUDED_SECTION_RE.test(id)) return true;
      }
    }
    return false;
  }

  function inScope(el, scopeSet) {
    if (scopeSet) return scopeSet.has(el);
    return !isExcludedSection(el);
  }

  function findMemberCardContainer() {
    // Recompute the section scope each call (cheap relative to DOM churn
    // from async loading) so newly-rendered content is picked up.
    const scopeSet = getMemberSectionScope();

    for (const selector of CARD_SELECTOR_CANDIDATES) {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        continue; // :has() unsupported in some engines, skip gracefully
      }
      nodes = nodes.filter((n) => isVisible(n) && !isNavLikeContainer(n) && hasMeaningfulText(n) && inScope(n, scopeSet));
      if (nodes.length >= 2) {
        return { selector, nodes };
      }
    }

    // Fallback heuristic: look for a repeated set of sibling elements that
    // each contain a link and a chunk of text resembling a name/profession,
    // e.g. generic <div>/<li> grids rendered by a JS framework. Restricted
    // to the Member List section (or, if that section can't be located,
    // to everything EXCEPT known non-member widgets like blog/news feeds)
    // so unrelated page content can never be mistaken for member cards.
    // Include table/tbody/ol so rosters rendered as plain HTML tables or
    // ordered lists are considered, not just div/ul/section grids.
    const containers = Array.from(document.querySelectorAll('div, ul, ol, section, table, tbody'))
      .filter((el) => el.children && el.children.length >= 3 && !isNavLikeContainer(el) && inScope(el, scopeSet));

    let best = null;
    for (const container of containers) {
      const children = Array.from(container.children)
        .filter((c) => isVisible(c) && !isNavLikeContainer(c) && hasMeaningfulText(c) && inScope(c, scopeSet));
      if (children.length < 3) continue;
      const withLinks = children.filter((c) => {
        const link = c.querySelector('a[href]');
        if (!link) return false;
        const href = link.getAttribute('href') || '';
        // Ignore placeholder/JS-triggered links with no real destination —
        // these are typical of pagination or "load more" controls, not
        // member profile links.
        return href !== '#' && !href.startsWith('javascript:');
      });
      if (withLinks.length >= Math.max(3, Math.floor(children.length * 0.6))) {
        if (!best || withLinks.length > best.nodes.length) {
          best = { selector: '(heuristic sibling group)', nodes: withLinks };
        }
      }
    }

    return best || { selector: null, nodes: [] };
  }

  function findLoadMoreButton() {
    const scopeSet = getMemberSectionScope();
    const clickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    return clickable.find((el) => isVisible(el) && inScope(el, scopeSet) && LOAD_MORE_TEXT_RE.test(cleanText(el.textContent)));
  }

  function findPaginationNextButton() {
    const scopeSet = getMemberSectionScope();
    const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], li'));
    return clickable.find((el) => {
      if (!isVisible(el) || !inScope(el, scopeSet)) return false;
      const text = cleanText(el.textContent);
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const isDisabled = el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true' || el.disabled;
      if (isDisabled) return false;
      return NEXT_PAGE_TEXT_RE.test(text) || aria.includes('next');
    });
  }

  async function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    await delay(300);
  }

  // Many BNI chapter sites show a loading spinner (e.g. an "ajax-loader.gif"
  // image, or a ".loading"/".spinner" element) while the member roster is
  // fetched asynchronously after the page shell has already rendered. If we
  // start looking for member cards immediately, we can mistake unrelated
  // page furniture (nav, pagination) for the real content. This waits for
  // visible loading indicators to disappear, or gives up after a timeout.
  async function waitForPageToSettle({ timeout = 6000 } = {}) {
    const loaderSelectors = [
      'img[src*="ajax-loader"]',
      'img[src*="loading"]',
      '.loading',
      '.spinner',
      '.loader',
      '[class*="loading-indicator"]'
    ];

    const hasVisibleLoader = () => {
      for (const sel of loaderSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (isVisible(el)) return true;
        }
      }
      return false;
    };

    if (!hasVisibleLoader()) return;

    if (global.BNILogger) global.BNILogger.info('Waiting for the page to finish loading member data...');
    await waitFor(() => !hasVisibleLoader(), { timeout, interval: 300 });
    await delay(400); // small settle buffer after loader disappears
  }

  /**
   * Iteratively reveals all members: clicks "Load More" until it disappears
   * or stops adding cards, tries scroll-triggered infinite scroll, and
   * clicks pagination "Next" if present, collecting unique cards along the
   * way. Returns the final list of unique member card elements found.
   *
   * onProgress(count) is called after each round so the popup log can show
   * live progress.
   */
  async function discoverAllMembers({ onProgress, shouldStop, maxRounds = 60 } = {}) {
    await waitForPageToSettle();

    const scopeCheck = getMemberSectionScope();
    if (global.BNILogger) {
      global.BNILogger.info(
        scopeCheck
          ? `Located a "Member List" section boundary (${scopeCheck.size} elements in scope). Restricting search to it.`
          : 'Could not find a "Member List" heading to scope the search — searching the whole page, excluding known non-member widgets (blog/news/gallery/etc).'
      );
    }

    const seen = new Set();
    let { selector, nodes } = findMemberCardContainer();
    nodes.forEach((n) => seen.add(n));

    if (global.BNILogger) {
      global.BNILogger.info(
        selector
          ? `Member card pattern detected (${selector}). ${nodes.length} found initially.`
          : 'No member cards found in initial DOM — checking for dynamic loading...'
      );
    }

    let rounds = 0;
    let stagnantRounds = 0;

    while (rounds < maxRounds) {
      if (shouldStop && shouldStop()) {
        if (global.BNILogger) global.BNILogger.warn('Stopping discovery: user requested stop.');
        break;
      }
      rounds++;

      const loadMoreBtn = findLoadMoreButton();
      const nextBtn = !loadMoreBtn ? findPaginationNextButton() : null;
      let acted = false;

      if (loadMoreBtn) {
        if (global.BNILogger) global.BNILogger.info('Clicking "Load More"...');
        loadMoreBtn.click();
        acted = true;
      } else if (nextBtn) {
        if (global.BNILogger) global.BNILogger.info('Clicking pagination "Next"...');
        nextBtn.click();
        acted = true;
      } else {
        // try scroll-triggered infinite scroll as a last resort
        await scrollToBottom();
      }

      await politeDelay(700, 500);

      // Wait briefly for new content to render
      await waitFor(() => true, { timeout: 400, interval: 400 });

      const before = seen.size;
      const found = findMemberCardContainer();
      found.nodes.forEach((n) => seen.add(n));

      if (onProgress) onProgress(seen.size);

      if (seen.size === before) {
        stagnantRounds++;
      } else {
        stagnantRounds = 0;
        if (global.BNILogger) global.BNILogger.info(`${seen.size} members found so far...`);
      }

      // Stop if nothing happened (no button acted upon and no scroll growth)
      // across two consecutive rounds.
      if (!acted && stagnantRounds >= 2) break;
      if (acted && stagnantRounds >= 3) break; // button present but stopped yielding new cards
    }

    if (global.BNILogger) {
      global.BNILogger.info(`Discovery complete. ${seen.size} member card(s) found.`);
    }

    return Array.from(seen);
  }

  global.BNIMemberDiscovery = {
    findMemberCardContainer,
    findLoadMoreButton,
    findPaginationNextButton,
    getMemberSectionScope,
    discoverAllMembers
  };
})(typeof window !== 'undefined' ? window : this);
