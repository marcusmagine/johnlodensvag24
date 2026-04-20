/**
 * Regenerate index.html from existing metadata.json + fix title/facts.
 */

import fs from 'fs/promises';
import path from 'path';

const OUT_DIR  = path.resolve('archive');
const JSON_DIR = path.join(OUT_DIR, 'assets', 'json');

const raw = await fs.readFile(path.join(JSON_DIR, 'metadata.json'), 'utf8');
const metadata = JSON.parse(raw);

// Fix title (use real page title, not browser tab)
metadata.meta.title    = 'John Lodéns väg 24, Storängen';
metadata.meta.subtitle = 'Villa · Stockholm';
metadata.meta.price    = '9 900 000 kr · Såld';

// Build clean structured facts from the raw text data
metadata.meta.structuredFacts = [
  { label: 'Adress',       value: 'John Lodéns väg 24, Storängen' },
  { label: 'Antal rum',    value: '6 rum och kök varav 3–4 sovrum' },
  { label: 'Boarea',       value: '147 kvm' },
  { label: 'Våningsplan',  value: '3 våningar (hiss saknas)' },
  { label: 'Månadsavgift', value: '7 727 kr (renhållning ingår)' },
  { label: 'Slutpris',     value: '9 900 000 kr · Såld april 2026' },
  { label: 'Mäklare',      value: 'Sara Wennertorp, BOSTHLM' },
  { label: 'Telefon',      value: '073-346 46 49' },
  { label: 'E-post',       value: 'sara@bosthlm.se' },
];

const html = generateHtml(metadata);
await fs.writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');
console.log('Done → archive/index.html');

// ─── HTML generator ───────────────────────────────────────────────────────────

function generateHtml(metadata) {
  const { sourceUrl, archivedAt, meta, images, documents } = metadata;
  const { title, subtitle, price, structuredFacts, broker, viewing } = meta;

  const factsHtml = `<dl class="facts-grid">
    ${structuredFacts.map(f =>
      `<div class="fact-item"><dt>${escHtml(f.label)}</dt><dd>${escHtml(f.value)}</dd></div>`
    ).join('\n    ')}
  </dl>`;

  const heroImages = images.slice(0, 5);
  const allImages  = images;

  const heroBento = heroImages.map((img, i) => `
  <figure class="bento-cell${i === 0 ? ' bento-main' : ''}">
    <a href="${escAttr(img.localPath)}" target="_blank">
      <img src="${escAttr(img.localPath)}" alt="Bild ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
    </a>
  </figure>`).join('');

  const galleryItems = allImages.map((img, i) => `
    <figure>
      <a href="${escAttr(img.localPath)}" target="_blank">
        <img src="${escAttr(img.localPath)}" alt="Bild ${i + 1}" loading="lazy">
      </a>
    </figure>`).join('');

  const docsHtml = documents.length
    ? `<ul class="docs-list">${documents.map(d =>
        `<li><a href="${escAttr(d.localPath)}" target="_blank">📄 ${escHtml(d.filename)}</a></li>`
      ).join('')}</ul>`
    : '';

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
      --sand:       #EDE8E0;
      --linen:      #F4F0E8;
      --ash:        #DDD8CF;
      --peat:       #28221E;
      --dusk:       #7D736A;
      --moss:       #4A5C50;
      --warm-white: #FDFCF9;
      --serif: 'Cormorant Garamond', Georgia, serif;
      --sans:  'Inter', -apple-system, sans-serif;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--sans);
      font-weight: 300;
      background: var(--linen);
      color: var(--peat);
      -webkit-font-smoothing: antialiased;
    }

    /* ── Bento hero ───────────────────────────────────────── */
    .bento {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      grid-template-rows: 300px 300px;
      gap: 3px;
      background: var(--peat);
      height: 603px;
    }
    .bento-main {
      grid-column: 1;
      grid-row: 1 / 3;
    }
    .bento-cell { overflow: hidden; }
    .bento-cell a { display: block; width: 100%; height: 100%; }
    .bento-cell img {
      width: 100%; height: 100%;
      object-fit: cover;
      transition: opacity .25s;
    }
    .bento-cell img:hover { opacity: .85; }

    @media (max-width: 700px) {
      .bento {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 220px 220px 220px;
        height: auto;
      }
      .bento-main { grid-column: 1 / 3; grid-row: 1; }
    }

    /* ── Page header ──────────────────────────────────────── */
    .page-header {
      max-width: 1100px;
      margin: 0 auto;
      padding: 2.5rem 2rem 1.5rem;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .page-header-left h1 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(2rem, 4vw, 3.2rem);
      line-height: 1.1;
      letter-spacing: -.01em;
    }
    .page-header-left .subtitle {
      color: var(--dusk);
      font-size: .85rem;
      margin-top: .3rem;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .page-header-right .price {
      font-family: var(--serif);
      font-size: 1.8rem;
      font-weight: 300;
      color: var(--moss);
      text-align: right;
    }
    .archive-badge {
      font-size: .7rem;
      color: var(--dusk);
      background: var(--sand);
      padding: .25rem .6rem;
      border-radius: 2px;
      margin-top: .5rem;
      display: inline-block;
    }
    .archive-badge a { color: inherit; }

    /* ── Main layout ──────────────────────────────────────── */
    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 2rem 3rem;
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 3rem;
      align-items: start;
    }

    @media (max-width: 800px) {
      main { grid-template-columns: 1fr; }
    }

    section { margin-bottom: 2.5rem; }

    h2 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: 1.4rem;
      letter-spacing: .03em;
      margin-bottom: 1rem;
      padding-bottom: .4rem;
      border-bottom: 1px solid var(--ash);
    }

    /* ── Facts grid ───────────────────────────────────────── */
    .facts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 1px;
      background: var(--ash);
      border: 1px solid var(--ash);
      border-radius: 4px;
      overflow: hidden;
    }
    .fact-item {
      background: var(--warm-white);
      padding: .9rem 1rem;
    }
    .fact-item dt {
      font-size: .68rem;
      text-transform: uppercase;
      letter-spacing: .1em;
      color: var(--dusk);
      margin-bottom: .25rem;
    }
    .fact-item dd {
      font-size: .92rem;
      font-weight: 400;
      color: var(--peat);
      line-height: 1.4;
    }

    /* ── Image grid ───────────────────────────────────────── */
    .img-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 3px;
    }
    .img-grid figure {
      aspect-ratio: 4/3;
      overflow: hidden;
      background: #111;
    }
    .img-grid figure a { display: block; width: 100%; height: 100%; }
    .img-grid img {
      width: 100%; height: 100%;
      object-fit: cover;
      transition: opacity .2s;
    }
    .img-grid img:hover { opacity: .85; }

    /* ── Sidebar ──────────────────────────────────────────── */
    .sidebar { position: sticky; top: 2rem; }

    .card {
      background: var(--warm-white);
      border: 1px solid var(--ash);
      border-radius: 4px;
      padding: 1.4rem;
      margin-bottom: 1.2rem;
    }
    .card h3 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: 1rem;
      margin-bottom: .8rem;
      color: var(--peat);
    }
    .card p, .card pre {
      font-size: .83rem;
      line-height: 1.65;
      color: var(--dusk);
      white-space: pre-wrap;
    }
    .card a { color: var(--moss); text-decoration: none; }
    .card a:hover { text-decoration: underline; }

    .docs-list { list-style: none; }
    .docs-list li { margin: .4rem 0; }
    .docs-list a { color: var(--moss); font-size: .85rem; }

    footer {
      text-align: center;
      padding: 2rem;
      font-size: .72rem;
      color: #bbb;
      border-top: 1px solid var(--ash);
    }
  </style>
</head>
<body>

<!-- Bento hero -->
<div class="bento">
  ${heroBento}
</div>

<!-- Page header -->
<div class="page-header">
  <div class="page-header-left">
    <h1>${escHtml(title)}</h1>
    ${subtitle ? `<p class="subtitle">${escHtml(subtitle)}</p>` : ''}
    <span class="archive-badge">
      Arkiverad ${new Date(archivedAt).toLocaleString('sv-SE')} &nbsp;·&nbsp;
      <a href="${escAttr(sourceUrl)}" target="_blank">Originalkälla ↗</a>
    </span>
  </div>
  ${price ? `<div class="page-header-right"><p class="price">${escHtml(price)}</p></div>` : ''}
</div>

<main>
  <div class="content">
    <section>
      <h2>Fakta</h2>
      ${factsHtml}
    </section>

    <section>
      <h2>Alla bilder (${allImages.length})</h2>
      <div class="img-grid">
        ${galleryItems}
      </div>
    </section>

    ${docsHtml ? `<section>
      <h2>Dokument (${documents.length})</h2>
      ${docsHtml}
    </section>` : ''}
  </div>

  <aside class="sidebar">
    <div class="card">
      <h3>Mäklare</h3>
      <pre>Sara Wennertorp
BOSTHLM
073-346 46 49
sara@bosthlm.se</pre>
    </div>

    <div class="card">
      <h3>Rådata</h3>
      <p>
        <a href="assets/json/metadata.json">metadata.json</a><br>
        <a href="raw.html">raw.html</a><br>
        <a href="page_text.txt">page_text.txt</a>
      </p>
    </div>
  </aside>
</main>

<footer>Lokalt arkiv — John Lodéns väg 24, Storängen</footer>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str ?? '').replace(/"/g, '%22');
}
