# BNI Chapter Member Scraper (Chrome Extension)

A manual, single-chapter-at-a-time Chrome extension that extracts the
**publicly displayed** member information from a BNI chapter's public
member-list page and lets you export it to Excel or CSV.

It does **not** crawl the BNI network, does **not** log in, and does
**not** bypass any authentication, CAPTCHA, or access control. It only
reads what a normal, unauthenticated visitor to the page would already
see.

---

## 1. Install the extension in Chrome

1. Download/unzip the `bni-scraper` folder somewhere on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `bni-scraper` folder.
6. The "BNI Chapter Scraper" icon should now appear in your toolbar
   (pin it via the puzzle-piece icon if you don't see it).

## 2. Enable Developer Mode

Same as step 3 above — `chrome://extensions` → toggle **Developer mode**
on. This is required to load an unpacked (non–Chrome-Web-Store)
extension.

## 3. Load the unpacked extension

Covered in step 4-5 above. If you edit any file later, come back to
`chrome://extensions` and click the refresh icon on the extension's
card to reload your changes.

## 4. How to use it

1. Manually navigate to a BNI chapter's **public** member-list page,
   e.g.:
   `https://bni-jaipursouth.in/jaipur-south-bni--onyx/en-IN/memberlist?chapterName=26401&regionIds=23524`
2. Click the extension icon to open the popup.
3. Click **Detect Chapter** to confirm the page is recognized (this
   never scrapes anything — it only reads the URL/page metadata).
4. Click **Scrape This Chapter**.
5. Watch the **Scraping Log** — it shows each phase (detecting,
   finding members, collecting profiles, progress count).
6. When it finishes, the **Current Page** panel shows the member
   count, and a **Preview** table appears below the log.
7. Click **Stop** at any time to safely halt an in-progress scrape —
   whatever was collected so far is kept.

## 5. How to scrape a chapter

Just repeat steps 1–4 above for any other chapter's public
member-list page. Each chapter you scrape is added to the **Scraped
Chapters** history table at the bottom of the popup, so you always
have a record of what you've collected and when.

## 6. How to export Excel

After a scrape (or after clicking **Preview Data** to reload the last
scraped set), click **Export Excel**. A file named
`BNI_<ChapterName>_<YYYY-MM-DD>.xlsx` downloads via Chrome's normal
download flow, with:

- A single `Members` worksheet
- A frozen header row
- Auto-sized columns
- Clickable hyperlinks for Profile URL / Chapter URL / Source URL /
  Website columns

Click **Export CSV** for a UTF-8 `.csv` version of the same data.

## 7. How master dataset mode works

Turn on **Append to Master Dataset** before scraping. Each chapter you
scrape afterwards is merged into a single running dataset
(`bni_master_dataset` in the extension's local storage) instead of
staying siloed per chapter. Merging:

- Deduplicates by Member ID → Profile URL → (Name + Company + Chapter
  ID), in that priority order
- Fills in any blank fields with newly scraped data
- Updates the "Scraped At" timestamp to the latest scrape

There's no dedicated "export master dataset" button in this v1 UI —
if you want a `BNI_Master.xlsx` file, the master dataset is stored
under `chrome.storage.local` key `bni_master_dataset` and can be
exported the same way the per-chapter data is (a follow-up UI button
can be wired to `BNIStorage.getMasterDataset()` +
`BNIExcelExporter.exportToExcel()` in a few lines if you want it
surfaced directly).

## 8. How to debug selector changes

Turn on the **Debug** checkbox in the top-right of the popup. This
reveals a **Debug Info** panel showing:

- Detected chapter ID / region ID / chapter name (and which detection
  strategy found them)
- The member-card CSS selector pattern that matched
- Number of member cards found
- Whether "Load More" and/or pagination controls were detected
- Any errors hit during extraction

Click **Copy Debug Information** to copy this JSON to your clipboard
so you (or whoever maintains the extension) can quickly see what
changed on the target site and update the selector heuristics in
`content/memberExtractor.js` / `content/memberDiscovery.js`
accordingly — without needing to rewrite the whole extension.

## 9. What information the extension can and cannot collect

**Can collect** (when publicly visible on the page or a linked public
profile page): member name, company name, profession/business
category, phone, email, website, address, city, state, country,
profile URL, chapter name/ID, region ID.

**Cannot and will not collect**: anything behind a login, CAPTCHA, or
other access control; BNI Connect account data; payment or billing
information; data from chapters you haven't manually opened yourself.
If a field isn't publicly visible, it's left blank — nothing is
guessed or fabricated.

The extension only acts on the single chapter page you have open. It
never automatically discovers or visits other chapters.

## 10. Privacy / security considerations

- **Manifest V3**, minimal permissions: `activeTab`, `scripting`,
  `storage`, `downloads`, `tabs`, and broad `host_permissions` (needed
  because BNI chapter sites live on many different domains/subdomains
  and you may scrape any of them).
- No credentials, passwords, or auth tokens are ever requested,
  stored, or transmitted.
- All scraped data stays in your browser's local storage
  (`chrome.storage.local`) until **you** export it — nothing is sent
  to any external server.
- Scraping only ever starts when you click **Scrape This Chapter**.
  The content script is injected on demand, not on every page load.
- Please make sure your use complies with the target site's
  `robots.txt`, Terms of Service, and any applicable data-protection
  law (e.g. GDPR/DPDP) for your intended use of this publicly
  displayed business-directory information — this tool automates
  *reading a public page*, it doesn't grant you any additional right
  to the data.

---

## Project structure

```
bni-scraper/
├── manifest.json                Manifest V3 config, minimal permissions
├── popup/
│   ├── popup.html               Popup UI markup
│   ├── popup.css                Popup styling
│   └── popup.js                 Popup logic: tabs, messaging, storage, export, UI state
├── content/
│   ├── content.js                Injected entry point; message router for the active tab
│   ├── chapterDetector.js        Multi-strategy chapter/region ID detection
│   ├── memberDiscovery.js        Finds member cards; drives Load More/pagination/scroll
│   ├── memberExtractor.js        Extracts fields from one member card (layered heuristics)
│   └── profileExtractor.js       Requests background to enrich from a public profile page
├── background/
│   └── service-worker.js         On-demand content-script injection + background-tab profile fetch
├── scraper/
│   └── bniGenericScraper.js      Orchestrates detect → discover → extract → dedupe → return
├── storage/
│   └── storage.js                chrome.storage.local wrapper (history, per-chapter data, master dataset, settings)
├── export/
│   └── excelExporter.js          XLSX (SheetJS) + CSV export, frozen header, hyperlinks
├── utils/
│   ├── logger.js                 In-memory + forwarded logging for the live log panel
│   ├── helpers.js                Text cleanup, delays, URL/query parsing, email/phone regex
│   └── deduplication.js          Member Id → Profile URL → Name+Company+Chapter dedupe/merge
├── lib/xlsx/
│   └── xlsx.core.min.js          Bundled SheetJS (MIT licensed), no remote code / no eval
└── icons/                        Toolbar icons
```

### How the scraper works (end to end)

1. **Chapter detection** (`chapterDetector.js`) combines URL query
   params (`chapterName`, `regionIds`, and common variants), the URL
   path slug, `<meta property="og:site_name">` / `<title>`, and common
   DOM header selectors. The first strategy to yield a value wins per
   field, so it degrades gracefully across differently-built BNI
   sites.
2. **Member discovery** (`memberDiscovery.js`) tries a ranked list of
   likely member-card selectors, falling back to a sibling-group
   heuristic (repeated elements each containing a link) if none of the
   known patterns match. It then loops: click "Load More" if present,
   else click pagination "Next" if present, else scroll to the bottom
   — polling after each action until no new cards appear for a couple
   of rounds in a row, or the user clicks **Stop**.
3. **Extraction** (`memberExtractor.js`) reads each card's structured
   fields first (class-name patterns, `data-*` attributes, semantic
   tags), then falls back to splitting the card's visible text into
   lines if structured selectors come up empty. Email/phone are
   pulled via regex over the card's visible text as a safety net.
4. **Optional profile enrichment** (`profileExtractor.js` +
   `service-worker.js`) can open a member's public profile URL in a
   background tab, extract the same kind of fields from that page, and
   close the tab — filling in only fields the list page didn't already
   have. This is opt-in and rate-limited via a polite delay between
   visits; it's disabled by default in this v1 build (toggle it on by
   setting `enrichFromProfiles` / `maxProfileVisits` in
   `storage.js`'s settings if you want it).
5. **Deduplication** (`deduplication.js`) merges records referring to
   the same member (from pagination overlap, etc.) using Member ID →
   Profile URL → Name+Company+Chapter, keeping the most complete
   non-empty values.
6. **Export** (`excelExporter.js`) builds a `.xlsx` via bundled
   SheetJS (frozen header row, auto-sized columns, hyperlinked URL
   columns) or a UTF-8 `.csv`, and triggers a normal Chrome download.

### How to test it against the ONYX chapter

1. Load the unpacked extension (see section 1).
2. Open:
   `https://bni-jaipursouth.in/jaipur-south-bni--onyx/en-IN/memberlist?chapterName=26401&regionIds=23524`
3. Open the extension popup, click **Detect Chapter** — you should see
   chapter name **ONYX**, chapter ID **26401**, region ID **23524**.
4. Click **Scrape This Chapter** and watch the log. If the page loads
   its member roster via client-side JS/XHR (common for BNI sites),
   discovery will wait for it to render before finding cards.
5. Turn on **Debug** beforehand if you want to see exactly which
   selector matched and whether Load More/pagination was detected —
   useful since BNI regional sites vary in markup.
6. Once complete, use **Preview Data**, then **Export Excel** or
   **Export CSV**.

### Extending to other chapters/sites

The generic scraper in `scraper/bniGenericScraper.js` is intentionally
adapter-shaped: it only depends on the four module interfaces
(`BNIChapterDetector.detect()`, `BNIMemberDiscovery.discoverAllMembers()`,
`BNIMemberExtractor.extractMemberCard()`, `BNIDedup.dedupe()`). If a
particular BNI regional site's markup doesn't match the generic
heuristics well, add a new file under `scraper/adapters/` that
implements the same shape, detect which adapter to use (e.g. by
hostname) inside `bniGenericScraper.js`, and fall back to the generic
one for everything else — no need to touch the popup, background
worker, or storage/export layers.
