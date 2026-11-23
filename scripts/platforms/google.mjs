// Google adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Keyword discovery on Google Images (udm=2), US market (hl=en&gl=us). No sign-in needed.
// Each result = one image: post url = the page the image comes from (data-lpage / imgrefurl), image_urls = [original, Google
// thumbnail] (ALTERNATES: from-page keeps the FIRST one that downloads; the original may be refused or AVIF, the thumbnail is JPEG),
// caption = the result title, author = the site's host name.
// Works in a HIDDEN tab: it reads the server-rendered result HTML (tiles in the DOM + the image data Google keeps in inline
// scripts) and pages by URL, never by infinite scroll: when nothing new is left on the page, ONE extract fetches the next result
// page (the "Next" link, else start=) with fetch() (same origin, the person's own Google session, no navigation, no scroll, no
// focus) and reads it the same way. One fetch per crawl step, so the Node-side wait of the crawl (research.scroll_wait_seconds
// .google) paces the pages like a person. At most SELECTORS.max_pages extra pages per query; a page with nothing new = end.
// Google's "unusual traffic" page (/sorry/, captcha form), a consent page or HTTP 429 = blocked (result --state blocked).
import { POST_JS } from '../collect-transfer.mjs';
import { enc, stripTracking, makePost, checksumOf, cutWords, packB64, COMPACT } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  // result tiles: Google Images keeps the source page in data-lpage and the image id in data-docid / data-id
  tile: ['[data-lpage]', 'div[data-docid]', 'div[data-id][data-ri]', 'div.isv-r[data-id]'],
  title: ['[role="heading"]', 'h3', '[data-title]'],
  imgres: 'a[href*="/imgres?"]',
  next: ['a#pnnext', 'a[aria-label="Next page"]', 'a[aria-label="More results"]'],
  // inline script data: [n,"<docid>",["<thumbnail>",h,w],["<original>",H,W] ... "2003":[null,"..","<source page>","<title>"
  data_re: /\[\d+,"([\w-]{6,})",\["(https:\/\/encrypted-tbn\d\.gstatic\.com\/images\?[^"]+)",(\d+),(\d+)\],\["(https?:\/\/[^"]+)",(\d+),(\d+)\]/.source,
  page_re: /"2003":\[null,"[^"]*","(https?:\/\/[^"]+)","((?:[^"\\]|\\.)*)"/.source,
  google_host: /(^|\.)(google|gstatic|googleusercontent|googleapis|youtube|ytimg|ggpht|doubleclick)\.[a-z.]+$/.source,
  page_step: 20,
  max_pages: 5,
  wall: {
    url: ['/sorry/', '(^|//)consent\\.google\\.'],
    title: [],
    text: ['unusual traffic from your computer network', 'before you continue to google'],
    login_form: [],
    captcha: ['form#captcha-form', '#recaptcha', 'div.g-recaptcha'],
    dialog: [],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
export const searchUrl = (query) => `https://www.google.com/search?q=${enc(String(query).replace(/^#/, '').trim())}&udm=2&hl=en&gl=us`;
// Only a Google /imgres link carries an id (docid=); a result's own url is the source page of another site.
export const postId = (url) => { try { const u = new URL(String(url || '')); return /(^|\.)google\./.test(u.hostname) ? u.searchParams.get('docid') || '' : ''; } catch { return ''; } };
export const IMAGE_ALTERNATES = true;
export const toPost = (t, ctx = {}) => {
  const p = makePost({ id: t.id, url: stripTracking(t.url), image_urls: t.image_urls || [], caption: t.caption, author: t.author, found_by: ctx.found_by || '' });
  return p && { ...p, alt_urls: [] };
};

// Why a Google page is a block page ('' = fine): captcha (/sorry/, "unusual traffic", captcha form) | consent (cookie consent wall).
// PURE and SELF-CONTAINED (embedded in the page script; tests run it on saved HTML). doc = a document (live or DOMParser), url = its address.
export function googleBlock(doc, url, S) {
  const u = String(url || (doc.location && doc.location.href) || '');
  const body = doc.body || doc.documentElement;
  const text = String((body && body.textContent) || '').replace(/\s+/g, ' ').slice(0, 4000).toLowerCase();
  const has = (list) => (list || []).some((s) => { try { return !!doc.querySelector(s); } catch (e) { return false; } });
  if (/\/sorry\//i.test(u) || has(S.wall.captcha) || /unusual traffic from your computer network/.test(text)) return 'captcha';
  if (/(^|\/\/)consent\.google\./i.test(u) || has(['form[action*="consent.google."]']) || /before you continue to google/.test(text)) return 'consent';
  return '';
}

// Google result tiles of a document -> { tiles: [{ id, url, image_urls[], caption, author }], next, count }.
// doc = the live page or a DOMParser document; text = the raw text holding Google's inline script data; base = the page url.
// PURE and SELF-CONTAINED (embedded in the page script; tests run it on saved HTML). Read only.
export function googleExtract(doc, text, base, S) {
  const abs = (h) => { try { return h ? new URL(h, base).href : ''; } catch (e) { return ''; } };
  const dec = (s) => { try { return JSON.parse('"' + s + '"'); } catch (e) { return String(s || '').replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'); } };
  const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } };
  const gre = new RegExp(S.google_host, 'i');
  const external = (u) => /^https?:\/\//i.test(u) && !gre.test(hostOf(u));
  const httpImg = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const attr = (el, n) => (el && el.getAttribute ? el.getAttribute(n) || '' : '');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return 'g' + h.toString(36); };
  // 1. the image data in the inline scripts (docid -> thumbnail, original, source page, title)
  const data = new Map();
  const T = String(text || '').replace(/\\"/g, '"');
  const re = new RegExp(S.data_re, 'g'), pre = new RegExp(S.page_re);
  let m;
  while ((m = re.exec(T))) {
    const e = { docid: m[1], thumb: dec(m[2]), orig: dec(m[5]) };
    const pm = T.slice(re.lastIndex, re.lastIndex + 6000).match(pre);
    if (pm) { e.page = dec(pm[1]); e.title = dec(pm[2]); }
    if (!data.has(e.docid)) data.set(e.docid, e);
  }
  // 2. the tiles in the DOM (order = the order on the page)
  const tiles = new Map();
  const put = (t) => {
    const k = t.docid || t.orig || t.page;
    if (!k) return;
    const o = tiles.get(k) || {};
    for (const [a, b] of Object.entries(t)) if (b && !o[a]) o[a] = b;
    tiles.set(k, o);
  };
  let els = [];
  try { els = [...doc.querySelectorAll(S.tile.join(', '))]; } catch (e) { els = []; }
  for (const el of els) {
    const docid = attr(el, 'data-docid') || attr(el, 'data-id') || attr(el.closest && el.closest('[data-docid]'), 'data-docid');
    let page = attr(el, 'data-lpage') || attr(el.querySelector('[data-lpage]'), 'data-lpage');
    if (!page) for (const a of el.querySelectorAll('a[href]')) { const h = abs(attr(a, 'href')); if (external(h)) { page = h; break; } }
    const img = el.querySelector('img');
    const thumb = httpImg(attr(img, 'src')) || httpImg(attr(img, 'data-src'));
    let title = clean(attr(img, 'alt'));
    if (!title) for (const s of S.title) { const x = el.querySelector(s); const v = clean(x && (attr(x, 'data-title') || x.textContent)); if (v) { title = v; break; } }
    put({ docid, page: abs(page), thumb, title });
  }
  for (const a of doc.querySelectorAll(S.imgres)) {
    let u; try { u = new URL(attr(a, 'href'), base); } catch (e) { continue; }
    const img = a.querySelector('img');
    put({ docid: u.searchParams.get('docid') || '', orig: httpImg(u.searchParams.get('imgurl')), page: httpImg(u.searchParams.get('imgrefurl')), thumb: httpImg(attr(img, 'src')), title: clean(attr(img, 'alt')) });
  }
  // 3. join: DOM tiles get the script data of their docid; script entries with no tile (pages read with fetch) count too
  for (const [k, t] of tiles) { const d = t.docid && data.get(t.docid); if (d) tiles.set(k, Object.assign({}, d, Object.fromEntries(Object.entries(t).filter(([, v]) => v)))); }
  for (const d of data.values()) if (d.page && ![...tiles.values()].some((t) => t.docid === d.docid)) tiles.set(d.docid, Object.assign({}, d));
  const out = [], ids = new Set();
  for (const t of tiles.values()) {
    const url = external(t.page) ? t.page : httpImg(t.orig);
    const image_urls = [...new Set([httpImg(t.orig), httpImg(t.thumb)].filter(Boolean))];
    if (!url || !image_urls.length) continue;
    const id = t.docid || fnv(String(t.orig || t.page));
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({ id, url, image_urls, caption: clean(t.title), author: hostOf(external(t.page) ? t.page : '') });
  }
  let next = '';
  for (const s of S.next) { let a = null; try { a = doc.querySelector(s); } catch (e) { a = null; } const h = abs(attr(a, 'href')); if (h) { next = h; break; } }
  return { tiles: out, next, count: out.length };
}

// The next result page when the page has no "Next" link: the same search with start= moved on by what the last page held.
export function nextStartUrl(url, start) {
  try { const u = new URL(url); u.searchParams.set('start', String(start)); return u.href; } catch (e) { return ''; }
}

// ---- extract script (Playwright MCP browser_run_code_unsafe): reads the page (and, when nothing new is left, ONE next result page) ----
// opts: { found_by, max, seen[] }. State of the paging (tiles read, pages fetched, next url) stays in window.__sa_google[<page url>].
export function pageScript(opts) {
  const o = { platform: 'google', max: 0, seen: [], compact: COMPACT, ...opts, S: SELECTORS };
  return `async (page) => {
  const packB64 = ${packB64};
  const o = ${JSON.stringify(o)};
  for (let i = 0; i < 4; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('[data-lpage], [data-docid], a[href*="/imgres?"], form#captcha-form').length).catch(() => 0);
    if (n > 0) break;
    await page.waitForTimeout(500);
  }
  const r = await page.evaluate(async (o) => {
    const googleExtract = ${googleExtract};
    const googleBlock = ${googleBlock};
    const nextStartUrl = ${nextStartUrl};
    const checksumOf = ${checksumOf};
    const cutWords = ${cutWords};
    const S = o.S;
    const G = (window.__sa_google = window.__sa_google || {});
    const st = G[location.href] || (G[location.href] = { tiles: new Map(), pages: 0, next: '', start: 0, last: 0, done: false });
    const scriptText = (d) => [...d.querySelectorAll('script')].map((x) => x.textContent || '').join(' ');
    const add = (list) => { let n = 0; for (const t of list) if (!st.tiles.has(t.id)) { st.tiles.set(t.id, t); n++; } return n; };
    let reason = googleBlock(document, location.href, S), note = '', blockedUrl = reason ? location.href : '';
    if (!reason) {
      const cur = googleExtract(document, scriptText(document), location.href, S);
      add(cur.tiles);
      if (!st.pages) { st.next = cur.next; st.last = Math.max(st.last, cur.count); }
    }
    const seen = new Set(o.seen || []);
    const fresh = () => [...st.tiles.values()].filter((t) => !seen.has(t.id));
    if (!reason && !fresh().length && !st.done) {
      if (st.pages >= S.max_pages) st.done = true;
      else {
        const start = st.start + Math.max(S.page_step, st.last || 0);
        const url = st.next || nextStartUrl(location.href, start);
        try {
          const res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
          st.pages++;
          const html = await res.text();
          const d = new DOMParser().parseFromString(html, 'text/html');
          reason = res.status === 429 ? 'captcha' : googleBlock(d, res.url || url, S);
          if (reason) blockedUrl = res.url || url;
          else {
            const pg = googleExtract(d, html, url, S);
            const n = add(pg.tiles);
            st.start = start; st.last = pg.count; st.next = pg.next;
            if (!pg.count) note = 'next page had no results (HTTP ' + res.status + ')';
            if (!n) st.done = true;
          }
        } catch (e) { note = 'next page fetch failed: ' + String((e && e.message) || e).slice(0, 60); st.done = true; }
      }
    }
    let list = reason ? [] : fresh();
    if (o.max) list = list.slice(0, o.max);
    const cut = (x, n) => String(x || '').replace(/\\s+/g, ' ').trim().slice(0, n);
    const C = o.compact;
    return { platform: 'google', url: location.href, loginWall: !!reason, reason, signals: reason ? { url: blockedUrl, title: document.title, captcha: reason === 'captcha' } : null,
      ...(st.done && !list.length ? { closed: true } : {}), note: cut(note, 80), pages: st.pages,
      total: list.length, total_on_page: st.tiles.size, checksum: checksumOf(list.map((t) => t.id)),
      tiles: list.map((t) => ({ id: t.id, url: t.url, image_urls: t.image_urls.slice(0, C.images), caption: cutWords(t.caption, C.caption), author: cut(t.author, C.author) })) };
  }, o);
  const p = packB64(r);
  ${POST_JS}
}`;
}
