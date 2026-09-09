/**
 * memberExtractor.js
 * Extracts publicly displayed fields from a single member-card DOM element.
 * Uses a layered set of heuristics (data attributes, semantic tags, class
 * name patterns, plain visible text) rather than one brittle selector, so
 * it degrades gracefully across different BNI site templates.
 */
(function (global) {
  const { cleanText, absoluteUrl, extractEmail, extractPhone } = global.BNIHelpers;

  function textFromSelectors(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) {
        const text = cleanText(el.textContent);
        if (text) return text;
      }
    }
    return '';
  }

  function attrFromDataset(root, keys) {
    for (const key of keys) {
      if (root.dataset && root.dataset[key]) return root.dataset[key];
      const attr = root.getAttribute && root.getAttribute(`data-${key}`);
      if (attr) return attr;
    }
    return '';
  }

  function isRealLink(el) {
    if (!el) return false;
    const href = el.getAttribute('href') || '';
    return href && href !== '#' && !href.startsWith('javascript:');
  }

  function extractProfileLink(root) {
    const candidates = Array.from(root.querySelectorAll('a[href]'));
    const link = candidates.find((a) => isRealLink(a) && /profile|member|detail/i.test(a.getAttribute('href'))) ||
      candidates.find(isRealLink);
    if (!link) return '';
    return absoluteUrl(link.getAttribute('href'), window.location.href);
  }

  function extractMemberIdFromLink(profileUrl) {
    if (!profileUrl) return '';
    // common patterns: ?memberId=123, /member/123, /profile/123
    const qsMatch = profileUrl.match(/[?&](memberId|memberID|member_id|id)=([\w-]+)/i);
    if (qsMatch) return qsMatch[2];
    const pathMatch = profileUrl.match(/\/(member|profile)s?\/([\w-]{4,})/i);
    if (pathMatch) return pathMatch[2];
    return '';
  }

  function guessNameAndTitle(root) {
    // Many BNI card templates put the member's name in a heading-ish
    // element and profession/company just after it.
    const nameSelectors = ['.member-name', '.memberName', '.name', 'h3', 'h4', 'h5', 'strong', '.title'];
    const name = textFromSelectors(root, nameSelectors);

    const professionSelectors = ['.profession', '.category', '.business-category', '.member-category', '.designation'];
    const profession = textFromSelectors(root, professionSelectors);

    const companySelectors = ['.company', '.company-name', '.companyName', '.business-name', '.organisation', '.organization'];
    const company = textFromSelectors(root, companySelectors);

    return { name, profession, company };
  }

  function fallbackFromRawText(root, alreadyFound) {
    // If structured selectors found nothing, fall back to splitting the
    // card's visible text into lines and guessing by position. This is
    // intentionally conservative: it only fills fields that are still
    // empty.
    const rawText = cleanText(root.innerText || root.textContent || '');
    if (!rawText) return alreadyFound;

    const lines = (root.innerText || '')
      .split('\n')
      .map((l) => cleanText(l))
      .filter(Boolean);

    const result = { ...alreadyFound };
    if (!result.name && lines[0]) result.name = lines[0];
    if (!result.profession && lines[1]) result.profession = lines[1];
    if (!result.company && lines[2]) result.company = lines[2];
    return result;
  }

  function extractMemberCard(root) {
    const profileUrl = extractProfileLink(root);
    const memberIdFromAttr = attrFromDataset(root, ['memberId', 'member-id', 'id']);
    const memberIdFromLink = extractMemberIdFromLink(profileUrl);

    let { name, profession, company } = guessNameAndTitle(root);
    if (!name || !profession || !company) {
      const filled = fallbackFromRawText(root, { name, profession, company });
      name = filled.name;
      profession = filled.profession;
      company = filled.company;
    }

    const rawText = cleanText(root.innerText || root.textContent || '');
    const email = extractEmail(rawText) || extractEmail(root.innerHTML);
    const phone = extractPhone(rawText);

    const record = {
      memberId: memberIdFromAttr || memberIdFromLink || '',
      memberName: name || '',
      companyName: company || '',
      profession: profession || '',
      businessCategory: profession || '',
      phone: phone || '',
      email: email || '',
      website: '',
      address: '',
      city: '',
      state: '',
      country: '',
      profileUrl: profileUrl || '',
      _rawTextDebug: rawText.slice(0, 300) // kept only for debug mode, stripped before export
    };

    return record;
  }

  global.BNIMemberExtractor = { extractMemberCard };
})(typeof window !== 'undefined' ? window : this);
