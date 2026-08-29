/**
 * Accessibility audit. Serves the built site and runs axe-core over every page
 * at desktop and mobile widths, then does the checks axe cannot: keyboard
 * reachability with a visible focus ring, reduced-motion, reflow at 320px, and
 * heading structure.
 *
 *   npm run build && npm run audit:a11y
 *
 * Exits non-zero on any violation, so it works as a CI gate.
 */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../dist/client/', import.meta.url).pathname;
const PORT = 4488;
const BASE = `http://127.0.0.1:${PORT}`;

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/**
 * Deliberately no CSP here. The real site sends one, but axe has to inject a
 * script to run at all, and testing the DOM is the point of this file — the
 * policy itself is verified by the browser on the deployed site.
 */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let p = req.url.split('?')[0];
      if (p.endsWith('/')) p += 'index.html';
      let file = join(ROOT, p);
      if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
      if (!existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function routes(dir = ROOT) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await routes(full)));
    else if (entry.name.endsWith('.html')) {
      const rel = relative(ROOT, full);
      found.push(rel === '404.html' ? '/404.html' : `/${rel.replace(/index\.html$/, '')}`);
    }
  }
  return found.sort();
}

const server = await serve();
const axe = await readFile(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const paths = await routes();
const browser = await chromium.launch();
const failures = [];

// --- axe-core, every page, two widths -------------------------------------
for (const width of [1440, 390]) {
  for (const path of paths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axe });
    const { violations } = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      }),
    );
    for (const v of violations) {
      failures.push(`${width}px ${path} — ${v.id} (${v.impact}): ${v.help}`);
    }
    await page.close();
  }
}

// --- Keyboard: every stop needs a focus ring ------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        key: `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 30)}`,
        visible: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
        rendered: box.width > 0 || box.height > 0,
      };
    });
    if (!stop) continue;
    if (seen.has(stop.key)) break;
    seen.add(stop.key);
    if (!stop.visible && stop.rendered) failures.push(`keyboard — no focus ring on ${stop.key}`);
  }
  await page.close();
}

// --- prefers-reduced-motion -----------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (parseFloat(cs.transitionDuration) || 0) > 0.1 || (parseFloat(cs.animationDuration) || 0) > 0.1;
      })
      .map((el) => el.className || el.tagName)
      .slice(0, 5),
  );
  for (const m of moving) failures.push(`reduced-motion — still animating: ${m}`);
  await page.close();
}

// --- Reflow at 320px, and heading structure -------------------------------
for (const path of paths) {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) failures.push(`reflow — ${path} scrolls horizontally by ${overflow}px at 320px`);

  const levels = await page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])),
  );
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) failures.push(`headings — ${path} has ${h1s} <h1> elements`);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      failures.push(`headings — ${path} skips h${levels[i - 1]} to h${levels[i]}`);
      break;
    }
  }
  await page.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} accessibility problem(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`audit-a11y: ${paths.length} pages, 2 widths, 0 violations.`);
