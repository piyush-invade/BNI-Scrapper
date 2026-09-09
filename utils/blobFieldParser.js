/**
 * blobFieldParser.js
 * Some chapter sites render member cards using inline text (spans/text
 * nodes with no block-level or tab-separated boundaries), which defeats
 * memberExtractor.js's raw-text-line fallback: instead of getting one
 * clean line per field, everything ends up glued into a single string in
 * `memberName`, e.g.:
 *
 *   "Anjana Dwivedi Ancient Sound Healing Centre Health & Wellness >
 *    Health & Wellness (Other) > Sound Healer +919958285754"
 *
 * This module detects that shape and repairs it into proper
 * memberName / companyName / businessCategory / profession fields, using:
 *   1. The member's real name from the `name` query param on their
 *      public profile URL (present on this platform's memberdetails
 *      links) — far more reliable than trying to re-derive it from text.
 *   2. The " > " chain, which cleanly separates Subcategory/Profession.
 *   3. A same-batch frequency check to find the shared "Industry" phrase
 *      that recurs across multiple members (a real category is shared by
 *      several members in a chapter; a company name is effectively
 *      unique), falling back to a small list of common BNI Industry
 *      names when a chapter is too small for a repeat to show up.
 */
(function (global) {
  const { cleanText } = global.BNIHelpers;

  // Safety net only — used when the batch is too small for the
  // frequency-based detection below to find a category shared by two or
  // more members. Not exhaustive; harmless if a chapter's category isn't
  // in this list (that record just falls back to the old behavior).
  const KNOWN_CATEGORY_FALLBACKS = [
    'Real Estate Services', 'Event & Business Service', 'Finance & Insurance',
    'Legal & Accounting', 'Health & Wellness', 'Architecture & Engineering',
    'Advertising & Marketing', 'Computer & Programming', 'Car & Motorcycle',
    'Education & Training', 'Photography & Video', 'Food & Beverage',
    'Personal Services', 'Construction', 'Manufacturing', 'Retail',
    'Travel', 'Communications', 'Transportation', 'Wholesale'
  ].sort((a, b) => b.length - a.length);

  function getNameFromProfileUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const raw = u.searchParams.get('name');
      return raw ? cleanText(raw.replace(/\+/g, ' ')) : '';
    } catch (e) {
      return '';
    }
  }

  // A real member name never contains " > " — that sequence only shows
  // up here when the raw-text fallback glued the "Category > Subcategory
  // > Profession" breadcrumb into the name field.
  function isUnsplitBlob(record) {
    return typeof record.memberName === 'string' && record.memberName.includes(' > ');
  }

  function stripLeadingName(text, name) {
    let rest = text;
    if (name && rest.startsWith(name)) {
      rest = rest.slice(name.length).trim();
      if (rest.startsWith(name)) rest = rest.slice(name.length).trim(); // site sometimes repeats it when there's no company
    }
    return rest;
  }

  function repairBlobRecords(records) {
    const parsed = records.map((record) => {
      if (!isUnsplitBlob(record)) return { record, head: null };

      const name = getNameFromProfileUrl(record.profileUrl);
      let blob = record.memberName;
      const phone = record.phone || '';
      if (phone && blob.endsWith(phone)) blob = blob.slice(0, -phone.length).trim();

      const parts = blob.split(' > ').map((p) => cleanText(p));
      const subcategory = parts.length > 1 ? parts[1] : '';
      const profession = parts.length > 2 ? parts.slice(2).join(' > ') : '';
      const head = stripLeadingName(parts[0] || '', name);

      return { record, head, name, subcategory, profession };
    });

    // Frequency of every plausible trailing category phrase (last 1-4
    // words) across the whole batch. Real Industry names recur across
    // members; company names don't, so the longest phrase that repeats
    // is almost always the true category.
    const freq = new Map();
    parsed.forEach(({ head }) => {
      if (!head) return;
      const words = head.split(' ').filter(Boolean);
      for (let n = 1; n <= Math.min(4, words.length); n++) {
        const candidate = words.slice(-n).join(' ');
        freq.set(candidate, (freq.get(candidate) || 0) + 1);
      }
    });

    parsed.forEach(({ record, head, name, subcategory, profession }) => {
      if (head === null) return; // untouched — wasn't a blob record

      const words = head.split(' ').filter(Boolean);
      let bestCandidate = '';
      // Walk from the longest candidate down to the shortest and take the
      // first one that actually recurs elsewhere in the batch (count >= 2).
      // (Deliberately NOT a "closest count wins" comparison — a singleton
      // candidate, i.e. one that only ever appears in this one record,
      // must never be picked as if it were a shared category.)
      for (let n = Math.min(4, words.length); n >= 1; n--) {
        const candidate = words.slice(-n).join(' ');
        if ((freq.get(candidate) || 0) >= 2) {
          bestCandidate = candidate;
          break;
        }
      }

      let category = '';
      let company = head;

      if (bestCandidate) {
        category = bestCandidate;
        company = head.slice(0, head.length - bestCandidate.length).trim();
      } else {
        for (const known of KNOWN_CATEGORY_FALLBACKS) {
          if (head.endsWith(known)) {
            category = known;
            company = head.slice(0, head.length - known.length).trim();
            break;
          }
        }
      }

      company = company.replace(/[\s-]+$/, '').trim();

      record.memberName = name || record.memberName;
      record.companyName = company;
      record.businessCategory = category;
      record.profession =
        subcategory && profession && subcategory !== profession
          ? `${subcategory} / ${profession}`
          : profession || subcategory || record.profession;
    });

    return records;
  }

  global.BNIBlobFieldParser = { repairBlobRecords, isUnsplitBlob, getNameFromProfileUrl };
})(typeof window !== 'undefined' ? window : this);
