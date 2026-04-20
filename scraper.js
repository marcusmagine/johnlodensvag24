/**
 * John Lodéns väg 24 — listing archiver for bosthlm.se
 * Usage: node scraper.js [URL]
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const TARGET_URL =
  process.argv[2] ||
  'https://www.bosthlm.se/1911307/john-lodens-vag-24-1911307';

const OUT_DIR    = path.resolve('archive');
const IMAGES_DIR = path.join(OUT_DIR, 'assets', 'images');
const DOCS_DIR   = path.join(OUT_DIR, 'assets', 'docs');
const JSON_DIR   = path.join(OUT_DIR, 'assets', 'json');

const IMAGE_BLOCKLIST = [
  /logo/i, /favicon/i, /icon/i, /avatar/i, /badge/i,
  /sprite/i, /pixel/i, /track/i, /analytics/i, /gtm/i,
  /facebook/i, /twitter/i, /google-tag/i, /\/svg\//i,
];

const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return name
    .replace(/[?#].*$/, '')
    .replace(/[^a-zA-Z0-9._\-åäöÅÄÖ]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
}

function resolveUrl(base, href) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

function isListingImage(url) {
  if (!url) return false;
  if (IMAGE_BLOCKLIST.some(re => re.test(url))) return false;
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext);
  } catch { return false; }
}

function isDoc(url) {
  if (!url) return false;
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return DOC_EXTENSIONS.includes(ext);
  } catch { return false; }
}

async function downloadFile(url, destPath, label = '') {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: TARGET_URL,
      },
    });
    if (!res.ok) { console.warn(`  [skip] ${res.status} ${url}`); return false; }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destPath, buf);
    console.log(`  [ok]   ${label || path.basename(destPath)}  (${(buf.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err) {
    console.warn(`  [err]  ${url}: ${err.message}`);
    return false;
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    const k = item.url || item;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

async function mkdirs() {
  for (const dir of [OUT_DIR, IMAGES_DIR, DOCS_DIR, JSON_DIR])
    await fs.mkdir(dir, { recursive: true });
}

// ─── DOM extraction (runs in browser context) ─────────────────────────────────

function extractFromDOM() {
  const meta = {};

  // Address / title
  const titleEl =
    document.querySelector('h1') ||
    document.querySelector('[class*="title"]') ||
    document.querySelector('[class*="address"]') ||
    document.querySelector('[class*="heading"]');
  if (titleEl) meta.title = titleEl.innerText.trim();

  // Price
  const priceEl = document.querySelector(
    '[class*="price"], [class*="pris"], [class*="askingprice"], [class*="asking-price"]'
  );
  if (priceEl) meta.price = priceEl.innerText.trim();

  // Facts / details table
  const factEls = document.querySelectorAll(
    '[class*="fact"], [class*="detail"], [class*="info"], [class*="spec"], ' +
    '[class*="attribute"], [class*="room"], [class*="pris"], [class*="price"], ' +
    '[class*="area"], [class*="size"], [class*="floor"], [class*="boyta"], ' +
    '[class*="avgift"], [class*="driftskostnad"], [class*="objektinfo"], ' +
    'dl dt, dl dd, table td, table th'
  );
  const facts = [];
  factEls.forEach(el => {
    const text = el.innerText.trim();
    if (text && text.length < 400) facts.push(text);
  });
  meta.facts = [...new Set(facts)];

  // Try to get structured key-value pairs from definition lists / tables
  const kvPairs = [];
  document.querySelectorAll('dl').forEach(dl => {
    const dts = dl.querySelectorAll('dt');
    dts.forEach(dt => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') {
        kvPairs.push({ label: dt.innerText.trim(), value: dd.innerText.trim() });
      }
    });
  });
  document.querySelectorAll('table tr').forEach(tr => {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length === 2) {
      kvPairs.push({ label: cells[0].innerText.trim(), value: cells[1].innerText.trim() });
    }
  });
  meta.kvPairs = kvPairs;

  // Description
  const descEl =
    document.querySelector('[class*="description"]') ||
    document.querySelector('[class*="beskrivning"]') ||
    document.querySelector('[class*="object-text"]') ||
    document.querySelector('[class*="objecttext"]') ||
    document.querySelector('[class*="listing-text"]') ||
    document.querySelector('article') ||
    document.querySelector('main p');
  if (descEl) meta.description = descEl.innerText.trim();

  // Broker info
  const brokerEl = document.querySelector(
    '[class*="broker"], [class*="agent"], [class*="maklare"], [class*="contact"]'
  );
  if (brokerEl) meta.broker = brokerEl.innerText.trim();

  // Viewing times / visning
  const viewingEl = document.querySelector(
    '[class*="viewing"], [class*="visning"], [class*="showing"], [class*="open-house"]'
  );
  if (viewingEl) meta.viewing = viewingEl.innerText.trim();

  // All <img> srcs (including data-src lazy)
  const imgs = Array.from(document.querySelectorAll('img'))
    .map(img =>
      img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original')
    )
    .filter(Boolean);

  // <source srcset> inside <picture>
  const srcsets = Array.from(document.querySelectorAll('source[srcset]'))
    .map(s => s.srcset.split(',').map(p => p.trim().split(' ')[0]))
    .flat()
    .filter(Boolean);

  // Anchor hrefs
  const anchors = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.href)
    .filter(Boolean);

  // Background images
  const bgImgs = Array.from(document.querySelectorAll('[style*="background"]'))
    .map(el => {
      const m = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      return m ? m[1] : null;
    })
    .filter(Boolean);

  // JSON-LD structured data
  const jsonLds = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map(s => s.textContent);

  // __NEXT_DATA__ (Next.js)
  const nextDataEl = document.querySelector('#__NEXT_DATA__');
  const nextData = nextDataEl ? nextDataEl.textContent : null;

  // Inline scripts containing image arrays
  const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
    .map(s => s.textContent)
    .filter(t => t && (
      t.includes('"images"') || t.includes('"photos"') || t.includes('"media"') ||
      t.includes('"imageUrl"') || t.includes('"pictureUrl"') || t.includes('"src"')
    ));

  // Full page text (for fallback)
  const bodyText = document.body?.innerText || '';

  return { meta, imgs, srcsets, anchors, bgImgs, jsonLds, nextData, inlineScripts, bodyText };
}

// ─── JSON image extraction ─────────────────────────────────────────────────────

function extractImageUrlsFromJson(jsonText) {
  const urls = [];
  if (!jsonText) return urls;
  let data;
  try { data = JSON.parse(jsonText); }
  catch {
    const re = /https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif|avif)[^"'\s]*/gi;
    return jsonText.match(re) || [];
  }
  function walk(node) {
    if (!node) return;
    if (typeof node === 'string') {
      if (/https?:\/\/.+\.(?:jpg|jpeg|png|webp|gif|avif)/i.test(node)) urls.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  }
  walk(data);
  return urls;
}

// ─── Image URL normalisation ───────────────────────────────────────────────────

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    // Strip Cloudinary-style transforms
    u.pathname = u.pathname.replace(/\/[a-z_]+,[a-z0-9_,]+\//gi, '/');
    // Remove resize query params
    ['w', 'h', 'width', 'height', 'q', 'quality', 'format', 'fit', 'crop',
     'auto', 'cs', 'fm', 'max-w', 'max-h'].forEach(p => u.searchParams.delete(p));
    return u.href;
  } catch { return url; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdirs();
  console.log(`\nTarget : ${TARGET_URL}`);
  console.log(`Output : ${OUT_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'sv-SE',
    extraHTTPHeaders: {
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
    },
  });

  // Intercept API JSON responses that may contain image metadata
  const interceptedJson = [];
  const interceptedImageUrls = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (
      ct.includes('application/json') &&
      (url.includes('api') || url.includes('object') || url.includes('listing') ||
       url.includes('home') || url.includes('property') || url.includes('photo') ||
       url.includes('media') || url.includes('image') || url.includes('bild'))
    ) {
      try {
        const json = await response.json().catch(() => null);
        if (json) {
          interceptedJson.push({ url, data: json });
          extractImageUrlsFromJson(JSON.stringify(json)).forEach(u => interceptedImageUrls.add(u));
        }
      } catch { /* ignore */ }
    }
  });

  const page = await context.newPage();

  console.log('Opening page...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 });

  // Accept cookie / GDPR consent banners
  for (const selector of [
    'button:has-text("Godkänn alla")',
    'button:has-text("Godkänn")',
    'button:has-text("Acceptera alla")',
    'button:has-text("Acceptera")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("OK")',
    'button:has-text("Tillåt alla")',
    '[id*="accept"]',
    '[class*="accept"]',
    '[class*="cookie"] button',
    '[class*="consent"] button',
    '[aria-label*="accept" i]',
    '[aria-label*="godkänn" i]',
  ]) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(1000);
        break;
      }
    } catch { /* not found */ }
  }

  // Scroll slowly to trigger lazy-loaded images
  console.log('Scrolling page...');
  let scrollPos = 0;
  const scrollStep = 500;
  while (true) {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    if (scrollPos >= scrollHeight) break;
    scrollPos = Math.min(scrollPos + scrollStep, scrollHeight);
    await page.evaluate(y => window.scrollTo(0, y), scrollPos);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  // Cycle through image gallery to load all photos
  console.log('Cycling gallery...');
  const gallerySelectors = [
    '[class*="gallery"] button[class*="next"]',
    '[class*="slider"] button[class*="next"]',
    '[class*="carousel"] button[class*="next"]',
    '[aria-label*="next" i]',
    '[aria-label*="nästa" i]',
    '[aria-label*="forward" i]',
    'button[class*="arrow-right"]',
    'button[class*="chevron-right"]',
    'button[class*="right"]',
    'button.next',
  ];
  for (const sel of gallerySelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      for (let i = 0; i < 60; i++) {
        try {
          await btn.click({ timeout: 800 });
          await page.waitForTimeout(300);
        } catch { break; }
      }
      break;
    }
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  // Extract all data from the DOM
  console.log('Extracting data...');
  const domData = await page.evaluate(extractFromDOM);

  // Save raw HTML
  const rawHtml = await page.content();
  await fs.writeFile(path.join(OUT_DIR, 'raw.html'), rawHtml, 'utf8');

  // Build combined image URL list
  let imageUrls = [
    ...domData.imgs,
    ...domData.srcsets,
    ...domData.bgImgs,
    ...[...interceptedImageUrls],
    ...domData.jsonLds.flatMap(extractImageUrlsFromJson),
    ...(domData.nextData ? extractImageUrlsFromJson(domData.nextData) : []),
    ...domData.inlineScripts.flatMap(extractImageUrlsFromJson),
  ]
    .map(u => resolveUrl(TARGET_URL, u))
    .filter(Boolean)
    .map(normalizeImageUrl)
    .filter(isListingImage);

  imageUrls = dedupeByUrl(imageUrls);

  // Build document URL list
  let docUrls = domData.anchors
    .map(u => resolveUrl(TARGET_URL, u))
    .filter(Boolean)
    .filter(isDoc);
  docUrls = dedupeByUrl(docUrls);

  // Save intercepted JSON blobs
  for (let i = 0; i < interceptedJson.length; i++) {
    await fs.writeFile(
      path.join(JSON_DIR, `api_response_${i + 1}.json`),
      JSON.stringify(interceptedJson[i], null, 2),
      'utf8'
    );
  }
  for (let i = 0; i < domData.jsonLds.length; i++) {
    await fs.writeFile(path.join(JSON_DIR, `jsonld_${i + 1}.json`), domData.jsonLds[i], 'utf8');
  }
  if (domData.nextData) {
    await fs.writeFile(path.join(JSON_DIR, 'next_data.json'), domData.nextData, 'utf8');
  }
  // Save full body text as plain text fallback
  if (domData.bodyText) {
    await fs.writeFile(path.join(OUT_DIR, 'page_text.txt'), domData.bodyText, 'utf8');
  }

  // Download images
  console.log(`\nFound ${imageUrls.length} listing images. Downloading...`);
  const downloadedImages = [];
  for (const url of imageUrls) {
    let filename;
    try {
      const u = new URL(url);
      filename = sanitizeFilename(path.basename(u.pathname)) || `image_${Date.now()}`;
      if (!path.extname(filename)) filename += '.jpg';
    } catch { filename = `image_${Date.now()}.jpg`; }

    let destPath = path.join(IMAGES_DIR, filename);
    let counter = 1;
    while (existsSync(destPath)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      destPath = path.join(IMAGES_DIR, `${base}_${counter}${ext}`);
      counter++;
    }

    const ok = await downloadFile(url, destPath, filename);
    if (ok) downloadedImages.push({ url, localPath: path.relative(OUT_DIR, destPath), filename: path.basename(destPath) });
  }

  // Download documents
  console.log(`\nFound ${docUrls.length} documents. Downloading...`);
  const downloadedDocs = [];
  for (const url of docUrls) {
    let filename;
    try {
      filename = sanitizeFilename(path.basename(new URL(url).pathname));
      if (!filename) filename = `document_${Date.now()}.pdf`;
    } catch { filename = `document_${Date.now()}.pdf`; }

    const destPath = path.join(DOCS_DIR, filename);
    const ok = await downloadFile(url, destPath, filename);
    if (ok) downloadedDocs.push({ url, localPath: path.relative(OUT_DIR, destPath), filename });
  }

  await browser.close();

  // Save metadata
  const metadata = {
    archivedAt: new Date().toISOString(),
    sourceUrl: TARGET_URL,
    meta: domData.meta,
    images: downloadedImages,
    documents: downloadedDocs,
  };
  await fs.writeFile(path.join(JSON_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

  // Generate the final site
  console.log('\nGenerating index.html...');
  const html = generateHtml(metadata);
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');

  console.log('\n─────────────────────────────────────────');
  console.log(`  Images downloaded : ${downloadedImages.length}`);
  console.log(`  Docs downloaded   : ${downloadedDocs.length}`);
  console.log(`  Archive at        : ${OUT_DIR}/index.html`);
  console.log('─────────────────────────────────────────\n');
}

// ─── HTML generator ───────────────────────────────────────────────────────────

function generateHtml(metadata) {
  const { sourceUrl, archivedAt, meta, images, documents } = metadata;

  const title       = meta.title       || 'John Lodéns väg 24';
  const price       = meta.price       || '';
  const description = meta.description || '';
  const facts       = (meta.facts || []).slice(0, 40);
  const kvPairs     = (meta.kvPairs || []).filter(kv => kv.label && kv.value);
  const broker      = meta.broker      || '';
  const viewing     = meta.viewing     || '';

  // Build facts section: prefer structured kv pairs, fall back to flat list
  let factsHtml = '';
  if (kvPairs.length > 0) {
    factsHtml = `<dl class="facts-grid">
      ${kvPairs.map(kv => `<div class="fact-item"><dt>${escHtml(kv.label)}</dt><dd>${escHtml(kv.value)}</dd></div>`).join('\n      ')}
    </dl>`;
  } else if (facts.length > 0) {
    factsHtml = `<ul class="facts-list">${facts.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>`;
  }

  const galleryHtml = images.length
    ? images.map((img, i) => `
      <figure class="gallery-item${i === 0 ? ' hero-img' : ''}">
        <a href="${escAttr(img.localPath)}" target="_blank">
          <img src="${escAttr(img.localPath)}" alt="Bild ${i + 1}" loading="${i < 4 ? 'eager' : 'lazy'}">
        </a>
      </figure>`).join('\n')
    : '<p class="empty">Inga bilder hittades.</p>';

  const docsHtml = documents.length
    ? `<ul class="docs-list">${documents.map(d =>
        `<li><a href="${escAttr(d.localPath)}" target="_blank">📄 ${escHtml(d.filename)}</a></li>`
      ).join('')}</ul>`
    : '<p class="empty">Inga dokument hittades.</p>';

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — Arkiv</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --sand:    #EDE8E0;
      --birch:   #FAFAF7;
      --linen:   #F4F0E8;
      --ash:     #DDD8CF;
      --peat:    #28221E;
      --dusk:    #7D736A;
      --moss:    #4A5C50;
      --fog:     #A8B3AA;
      --warm-white: #FDFCF9;
      --serif: 'Cormorant Garamond', Georgia, serif;
      --sans:  'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--sans);
      font-weight: 300;
      background: var(--linen);
      color: var(--peat);
      -webkit-font-smoothing: antialiased;
    }

    /* ── Hero gallery ─────────────────────────────────────── */
    .gallery-hero {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto auto;
      gap: 3px;
      background: var(--peat);
      max-height: 600px;
    }
    .gallery-hero .gallery-item {
      overflow: hidden;
      background: #111;
    }
    .gallery-hero .gallery-item:first-child {
      grid-column: 1;
      grid-row: 1 / 3;
    }
    .gallery-hero .gallery-item:nth-child(n+6) {
      display: none;
    }
    .gallery-hero .gallery-item a {
      display: block;
      width: 100%;
      height: 100%;
    }
    .gallery-hero .gallery-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: opacity .25s;
    }
    .gallery-hero .gallery-item img:hover { opacity: .88; }

    /* ── Header ───────────────────────────────────────────── */
    .site-header {
      padding: 3rem 2rem 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    .site-header h1 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(2rem, 5vw, 3.5rem);
      line-height: 1.1;
      letter-spacing: -.01em;
      color: var(--peat);
    }
    .site-header .price {
      font-family: var(--serif);
      font-size: 1.6rem;
      font-weight: 300;
      color: var(--moss);
      margin-top: .5rem;
    }
    .archive-notice {
      display: inline-block;
      margin-top: 1rem;
      font-size: .75rem;
      color: var(--dusk);
      background: var(--sand);
      border-radius: 3px;
      padding: .3rem .7rem;
    }
    .archive-notice a { color: inherit; text-decoration: underline; }

    /* ── Main layout ──────────────────────────────────────── */
    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 2rem;
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 3rem;
    }

    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; }
      .gallery-hero { grid-template-columns: 1fr; max-height: none; }
      .gallery-hero .gallery-item:first-child { grid-row: auto; }
    }

    /* ── Sections ─────────────────────────────────────────── */
    section { margin-bottom: 2.5rem; }

    h2 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: 1.5rem;
      letter-spacing: .02em;
      color: var(--peat);
      margin-bottom: 1rem;
      padding-bottom: .4rem;
      border-bottom: 1px solid var(--ash);
    }

    /* ── Facts grid ───────────────────────────────────────── */
    .facts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1px;
      background: var(--ash);
      border: 1px solid var(--ash);
      border-radius: 4px;
      overflow: hidden;
    }
    .fact-item {
      background: var(--warm-white);
      padding: .8rem 1rem;
    }
    .fact-item dt {
      font-size: .7rem;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--dusk);
      margin-bottom: .2rem;
    }
    .fact-item dd {
      font-size: .95rem;
      font-weight: 400;
      color: var(--peat);
    }

    .facts-list {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: .5rem;
    }
    .facts-list li {
      background: var(--warm-white);
      border: 1px solid var(--ash);
      border-radius: 3px;
      padding: .6rem 1rem;
      font-size: .875rem;
    }

    /* ── Description ──────────────────────────────────────── */
    .description {
      font-size: .95rem;
      line-height: 1.8;
      color: var(--peat);
      white-space: pre-wrap;
    }

    /* ── Sidebar ──────────────────────────────────────────── */
    .sidebar {
      align-self: start;
      position: sticky;
      top: 2rem;
    }
    .sidebar-card {
      background: var(--warm-white);
      border: 1px solid var(--ash);
      border-radius: 4px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .sidebar-card h3 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: 1.1rem;
      margin-bottom: .8rem;
      color: var(--peat);
    }
    .sidebar-card p, .sidebar-card pre {
      font-size: .85rem;
      line-height: 1.6;
      color: var(--dusk);
      white-space: pre-wrap;
    }

    /* ── All images section ───────────────────────────────── */
    .all-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 3px;
    }
    .all-gallery figure {
      aspect-ratio: 4/3;
      overflow: hidden;
      background: #111;
    }
    .all-gallery figure a { display: block; width: 100%; height: 100%; }
    .all-gallery img {
      width: 100%; height: 100%;
      object-fit: cover;
      transition: opacity .2s;
    }
    .all-gallery img:hover { opacity: .85; }

    /* ── Docs ─────────────────────────────────────────────── */
    .docs-list { list-style: none; }
    .docs-list li { margin: .5rem 0; }
    .docs-list a {
      color: var(--moss);
      text-decoration: none;
      font-size: .9rem;
    }
    .docs-list a:hover { text-decoration: underline; }

    .empty { color: var(--fog); font-size: .875rem; font-style: italic; }

    /* ── Footer ───────────────────────────────────────────── */
    footer {
      text-align: center;
      padding: 2rem;
      font-size: .75rem;
      color: var(--fog);
      border-top: 1px solid var(--ash);
      margin-top: 2rem;
    }
  </style>
</head>
<body>

<!-- Hero gallery: first 5 images in bento layout -->
<div class="gallery-hero" id="hero-gallery">
${images.slice(0, 5).map((img, i) => `  <figure class="gallery-item">
    <a href="${escAttr(img.localPath)}" target="_blank">
      <img src="${escAttr(img.localPath)}" alt="Bild ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
    </a>
  </figure>`).join('\n')}
</div>

<header class="site-header">
  <h1>${escHtml(title)}</h1>
  ${price ? `<p class="price">${escHtml(price)}</p>` : ''}
  <span class="archive-notice">
    Arkiverad ${new Date(archivedAt).toLocaleString('sv-SE')} &nbsp;·&nbsp;
    <a href="${escAttr(sourceUrl)}" target="_blank">Originalkälla ↗</a>
  </span>
</header>

<main>
  <div class="content">
    ${factsHtml ? `<section>
      <h2>Fakta</h2>
      ${factsHtml}
    </section>` : ''}

    ${description ? `<section>
      <h2>Beskrivning</h2>
      <div class="description">${escHtml(description)}</div>
    </section>` : ''}

    ${images.length > 5 ? `<section>
      <h2>Alla bilder (${images.length})</h2>
      <div class="all-gallery">
        ${images.map((img, i) => `<figure>
          <a href="${escAttr(img.localPath)}" target="_blank">
            <img src="${escAttr(img.localPath)}" alt="Bild ${i + 1}" loading="lazy">
          </a>
        </figure>`).join('\n        ')}
      </div>
    </section>` : ''}

    <section>
      <h2>Dokument (${documents.length})</h2>
      ${docsHtml}
    </section>
  </div>

  <aside class="sidebar">
    ${broker ? `<div class="sidebar-card">
      <h3>Mäklare</h3>
      <pre>${escHtml(broker)}</pre>
    </div>` : ''}

    ${viewing ? `<div class="sidebar-card">
      <h3>Visning</h3>
      <p>${escHtml(viewing)}</p>
    </div>` : ''}

    <div class="sidebar-card">
      <h3>Rådata</h3>
      <p>
        <a href="assets/json/metadata.json">metadata.json</a><br>
        <a href="raw.html">raw.html</a><br>
        <a href="page_text.txt">page_text.txt</a>
      </p>
    </div>
  </aside>
</main>

<footer>Lokalt arkiv — John Lodéns väg 24</footer>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str ?? '').replace(/"/g, '%22');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
