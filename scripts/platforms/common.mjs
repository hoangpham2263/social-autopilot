// Shared parts of the platform adapters (scripts/platforms/<platform>.mjs, used by scripts/collect.mjs).
// An adapter keeps ALL its selectors in one SELECTORS block at the top of its file; this module only holds the generic
// logic that reads them. extractTiles / wallSignals are PURE and SELF-CONTAINED (no imports, no outer variables): the
// collector sends their source text into the page (page.evaluate) and the tests run them on saved HTML (linkedom).
// They only READ the DOM: no click, no hover, no typing. The collector's only page action besides reading is scrolling.

// Search/grid tiles on the current page -> { tiles: [{ url, image_urls[], caption, author }], signals }.
// cfg: { base, link[], url_pattern (regex source), container (selector or ''), img[], img_skip[], author[], caption[] }
export function extractTiles(root, cfg) {
  const doc = root.ownerDocument || root;
  const base = cfg.base || (doc.location && doc.location.href) || 'https://example.com/';
  const all = (el, list) => {
    const out = [];
    for (const s of [].concat(list || [])) {
      let f = [];
      try { f = [...el.querySelectorAll(s)]; } catch { f = []; }
      for (const x of f) if (!out.includes(x)) out.push(x);
    }
    return out;
  };
  const attr = (el, n) => (el && el.getAttribute ? el.getAttribute(n) || '' : '');
  const abs = (h) => { try { return new URL(h, base).href; } catch { return ''; } };
  const re = new RegExp(cfg.url_pattern, 'i');
  const skip = (cfg.img_skip || []).map((s) => new RegExp(s, 'i'));
  const biggest = (srcset) => {
    let best = '', bw = -1;
    for (const part of String(srcset || '').split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d) || 0;
      if (u && w >= bw) { best = u; bw = w; }
    }
    return best;
  };
  const imgUrl = (i) => abs(biggest(attr(i, 'srcset')) || i.currentSrc || attr(i, 'src') || attr(i, 'data-src') || '');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const firstText = (box, list) => {
    for (const s of [].concat(list || [])) {
      let el = null;
      try { el = box.querySelector(s); } catch { el = null; }
      const v = clean(el && (attr(el, 'title') || attr(el, 'aria-label') || el.textContent));
      if (v) return v;
    }
    return '';
  };
  const tiles = new Map();
  let links = 0;
  for (const a of all(doc, cfg.link)) {
    const url = abs(attr(a, 'href'));
    if (!url || !re.test(url)) continue;
    links++;
    let box = a;
    if (cfg.container) { try { box = a.closest(cfg.container) || a; } catch { box = a; } }
    const t = tiles.get(url) || { url, image_urls: [], caption: '', author: '' };
    for (const i of [...all(box, cfg.img), ...all(a, cfg.img)]) {
      const u = imgUrl(i);
      if (!u || /^data:/i.test(u) || skip.some((r) => r.test(u)) || t.image_urls.includes(u)) continue;
      t.image_urls.push(u);
      if (!t.caption && clean(attr(i, 'alt')).length > 3) t.caption = clean(attr(i, 'alt'));
    }
    if (!t.caption) t.caption = firstText(box, cfg.caption);
    if (!t.caption) t.caption = clean(attr(a, 'aria-label') || attr(a, 'title'));
    if (!t.author) t.author = firstText(box, cfg.author);
    tiles.set(url, t);
  }
  return { tiles: [...tiles.values()], signals: { links, tiles: tiles.size } };
}

// What a login wall / captcha / block page looks like on the current page (read only).
// cfg: { login_form[], captcha[], dialog[] } (selectors). -> { url, title, text, login_form, captcha, dialog }
export function wallSignals(root, cfg) {
  const doc = root.ownerDocument || root;
  const has = (list) => {
    for (const s of [].concat(list || [])) { try { if (doc.querySelector(s)) return true; } catch { /* skip */ } }
    return false;
  };
  const body = doc.body || doc.documentElement;
  return {
    url: (doc.location && doc.location.href) || cfg.url || '',
    title: String(doc.title || ''),
    text: String((body && body.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 3000),
    login_form: has(cfg.login_form), captcha: has(cfg.captcha), dialog: has(cfg.dialog),
  };
}

// Generic block phrases (every platform); an adapter adds its own in SELECTORS.wall.
export const GENERIC_WALL_TEXT = ['unusual traffic', 'verify (that )?you are (a )?human', "confirm you'?re not a (bot|robot)", "make sure you'?re not a robot", 'are you a robot', 'access denied', 'too many requests', 'temporarily blocked', 'press (&|and) hold'];

// signals + the adapter's wall rules -> the reason ('' = no wall). rules: { url[], title[], text[] } regex sources.
export function classifyWall(sig = {}, rules = {}) {
  const test = (list, s) => (list || []).map((x) => new RegExp(x, 'i')).find((r) => r.test(String(s || '')));
  if (test(rules.url, sig.url)) return `login wall / block page (url ${String(sig.url).slice(0, 80)})`;
  if (sig.captcha) return 'captcha';
  if (sig.login_form) return 'login wall: login form on the page (Chrome not signed in?)';
  if (sig.dialog) return 'login wall: sign-in dialog covers the page';
  if (test(rules.title, sig.title)) return `blocked: title "${String(sig.title).slice(0, 60)}"`;
  const hay = `${sig.title || ''} ${sig.text || ''}`;
  const hit = test([...GENERIC_WALL_TEXT, ...(rules.text || [])], hay);
  return hit ? `blocked: "${(hay.match(hit) || [''])[0].slice(0, 80)}"` : '';
}

// Browser side of isLoginWall(page).
export async function pageWall(page, S) {
  const cfg = { login_form: S.wall.login_form, captcha: S.wall.captcha, dialog: S.wall.dialog };
  const sig = await page.evaluate(`(${wallSignals})(document, ${JSON.stringify(cfg)})`);
  return classifyWall(sig, S.wall);
}

// Browser side of a grid adapter's extract(page): one read of the tiles visible now (the collector scrolls between reads).
export async function gridExtract(page, S, finish, ctx = {}) {
  const cfg = { link: S.link, url_pattern: S.url_pattern, container: S.container, img: S.img, img_skip: S.img_skip, author: S.author, caption: S.caption, base: page.url() };
  const d = await page.evaluate(`(${extractTiles})(document, ${JSON.stringify(cfg)})`);
  return d.tiles.map((t) => finish(t, ctx)).filter(Boolean);
}

// Tracking parameters and fragments off a link.
export function stripTracking(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return String(url || '').trim(); }
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igshid|igsh|ref$|ref_|_nc_|__|sp_)/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href;
}
export const enc = encodeURIComponent;
// '#tag' vs plain keyword.
export const isHashtag = (q) => /^\s*#/.test(String(q || ''));
export const tagOf = (q) => String(q || '').trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();

// The post a tile becomes (the adapter contract): { id, url, image_urls, caption, author, found_by }.
export const makePost = ({ id, url, image_urls = [], caption = '', author = '', found_by = '' }) => (id && url
  ? { id, url, image_urls, caption: String(caption || '').slice(0, 2000), author: String(author || ''), found_by }
  : null);
