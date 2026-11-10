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
  // big: ignore tiny/hidden elements (the invisible reCAPTCHA badge iframe, 256x60, sits on normal pages); no layout (tests) = count it.
  const has = (list, big) => {
    for (const s of [].concat(list || [])) { try { for (const el of doc.querySelectorAll(s)) { if (big && typeof el.offsetWidth === 'number' && (el.offsetWidth < 200 || el.offsetHeight < 100)) continue; return true; } } catch { /* skip */ } }
    return false;
  };
  const body = doc.body || doc.documentElement;
  return {
    url: (doc.location && doc.location.href) || cfg.url || '',
    title: String(doc.title || ''),
    text: String((body && body.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 3000),
    login_form: has(cfg.login_form), captcha: has(cfg.captcha, true), dialog: has(cfg.dialog),
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

// Short checksum of the tile ids (FNV-1a 32 bit, base 36): SELF-CONTAINED, the page script embeds its source and
// `collect.mjs from-page` recomputes it, so a pasted result that was cut off or edited by hand is caught.
export function checksumOf(ids) {
  let h = 0x811c9dc5;
  const s = (ids || []).map(String).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
export const COMPACT = { caption: 100, author: 40, images: 2, chunk_size: 6 };

// ---- in-page mode: no CDP Chrome. The agent pastes this into Playwright MCP browser_run_code_unsafe (one call per keyword/page).
// A string `async (page) => {...}`: goes to the URL, scrolls with random pauses (delay [lo,hi] s, from collect.mjs: never below 5-15 s),
// reads the tiles after every pause (lazy images get time to load), and, when the adapter says post_fallback and a tile still has
// no image, reads that post's own page (GET only, same site) for og:image / og:description. Returns JSON
// { platform, url, loginWall, signals, tiles:[{id,url,image_urls,caption,author,found_by}], steps, note }. Read only.
// opts: { platform, url, found_by, max, steps, delay:[lo,hi], id_re (regex source, group 1 = id) }
export function buildPageScript(S, opts) {
  const cfg = { link: S.link, url_pattern: S.url_pattern, container: S.container, img: S.img, img_skip: S.img_skip, author: S.author, caption: S.caption };
  const wall = { login_form: S.wall.login_form, captcha: S.wall.captcha, dialog: S.wall.dialog, url: S.wall.url };
  const o = { compact: COMPACT, ...opts, cfg, wall, post_fallback: !!S.post_fallback, caption_strip: S.caption_strip || '' };
  return `async (page) => {
  const o = ${JSON.stringify(o)};
  await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const r = await page.evaluate(async (o) => {
    const extractTiles = ${extractTiles};
    const checksumOf = ${checksumOf};
    const wallSignals = ${wallSignals};
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const pause = () => sleep(1000 * (o.delay[0] + Math.random() * (o.delay[1] - o.delay[0])));
    const wallNow = () => {
      const sig = wallSignals(document, o.wall);
      const urlHit = (o.wall.url || []).some((x) => new RegExp(x, 'i').test(sig.url));
      return { sig, loginWall: urlHit || sig.captcha || sig.login_form || sig.dialog };
    };
    const id = (u) => ((String(u).match(new RegExp(o.id_re, 'i')) || [])[1]) || '';
    const tiles = new Map();
    let steps = 0, idle = 0, loginWall = false, signals = null, note = '';
    await pause();
    for (; steps < o.steps; steps++) {
      const w = wallNow();
      signals = { url: w.sig.url, title: w.sig.title, captcha: w.sig.captcha, login_form: w.sig.login_form, dialog: w.sig.dialog, text: w.sig.text.slice(0, 300) };
      if (w.loginWall) { loginWall = true; break; }
      const d = extractTiles(document, Object.assign({ base: location.href }, o.cfg));
      let fresh = 0;
      for (const t of d.tiles) {
        const k = id(t.url) || t.url;
        const old = tiles.get(k);
        if (!old) { tiles.set(k, { id: id(t.url), ...t, found_by: o.found_by }); fresh++; }
        else if (t.image_urls.length > old.image_urls.length) { old.image_urls = t.image_urls; if (!old.caption) old.caption = t.caption; if (!old.author) old.author = t.author; }
      }
      if (tiles.size >= o.max) break;
      idle = fresh ? 0 : idle + 1;
      if (idle >= 3) break;
      window.scrollBy(0, Math.round(innerHeight * 0.9));
      await pause();
    }
    let list = [...tiles.values()].slice(0, o.max);
    if (o.post_fallback && !loginWall) {
      for (const t of list.filter((x) => !x.image_urls.length)) {
        await pause();
        try {
          const res = await fetch(t.url, { credentials: 'include', headers: { Accept: 'text/html' } });
          const html = new DOMParser().parseFromString(await res.text(), 'text/html');
          const meta = (p) => (html.querySelector('meta[property="' + p + '"]') || {}).content || '';
          const img = meta('og:image');
          if (img) t.image_urls.push(img.replace(/&amp;/g, '&'));
          if (!t.caption) t.caption = meta('og:description') || meta('og:title');
          t.via_post_page = true;
        } catch (e) { note = 'post page read failed: ' + String(e.message || e).slice(0, 80); }
      }
    }
    if (o.caption_strip) for (const t of list) t.caption = String(t.caption || '').replace(new RegExp(o.caption_strip, 'i'), '').trim();
    // COMPACT result (short enough to read back and paste as is): fixed caption/author length, shortest url, first images only.
    const cut = (x, n) => String(x || '').replace(/\\s+/g, ' ').trim().slice(0, n);
    const shortUrl = (u) => { try { const x = new URL(u); x.hash = ''; if (!/[?&]v=/.test(x.search)) x.search = ''; return x.href; } catch (e) { return String(u || ''); } };
    const C = o.compact;
    const total = list.length, checksum = checksumOf(list.map((t) => t.id || t.url));
    let part = list, chunk = null;
    if (o.chunk !== undefined && o.chunk !== null) { part = list.slice(o.chunk * C.chunk_size, (o.chunk + 1) * C.chunk_size); chunk = { i: o.chunk, size: C.chunk_size, of: Math.max(1, Math.ceil(total / C.chunk_size)) }; }
    return { platform: o.platform, url: shortUrl(location.href), loginWall, signals: loginWall ? signals : null, steps, note: cut(note, 80), total, checksum, ...(chunk ? { chunk } : {}),
      tiles: part.map((t) => ({ id: t.id, url: shortUrl(t.url), image_urls: (t.image_urls || []).slice(0, C.images), caption: cut(t.caption, C.caption), author: cut(t.author, C.author), ...(t.via_post_page ? { via_post_page: 1 } : {}) })) };
  }, o);
  return r;
}`;
}
