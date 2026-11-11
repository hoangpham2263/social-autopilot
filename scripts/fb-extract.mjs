// Facebook page extraction (used by scripts/platforms/facebook.mjs). Every selector lives here, each with
// fallbacks (a list is tried in order and the matches are merged), so a Facebook DOM change is fixed in ONE place.
// extractFeed / extractGrid / extractViewer are PURE and SELF-CONTAINED (no imports, no outer variables): the source text is sent into the page and the tests run them on saved HTML
// (tests/fixtures/fb-*.html, linkedom). They read the DOM only (no click, no hover);
// Node-side helpers: parseFbDate (relative and absolute Facebook dates -> YYYY-MM-DD), detectBlock (checkpoint,
// captcha, login wall), tabUrl (the page's /posts, /photos_by, /reels tabs).

export const SELECTORS = {
  // One post (top-most match; comments are nested role=article and are ignored).
  container: ['[aria-posinset]', 'div[role="feed"] > div', 'div[data-pagelet^="TimelineFeedUnit"]', 'div[role="article"]'],
  // The post's text.
  message: ['[data-ad-rendering-role="story_message"]', '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]'],
  // Links that carry a post id (the permalink is usually the timestamp).
  post_link: ['a[href*="/posts/"]', 'a[href*="/permalink/"]', 'a[href*="story_fbid="]', 'a[href*="/videos/"]', 'a[href*="/reel/"]', 'a[href*="/watch/?v="]', 'a[href*="/photo/?fbid="]', 'a[href*="/photo?fbid="]', 'a[href*="/photo.php?fbid="]', 'a[href*="/photos/"]'],
  // "See more" inside a post's text (read only: its label is cut off the caption, never clicked).
  see_more: ['div[role="button"]', 'span[role="button"]'],
  see_more_text: ['See more', 'Xem thêm', 'Voir plus', 'Mehr ansehen', 'Ver más', 'Mostra altro'],
  // Timestamps whose link appears only on hover (href="#"); the extract script does not hover, it reads aria-label / abbr / time.
  hover: ['a[role="link"][href="#"]', 'a[role="link"]:not([href])', 'span[id] a[href="#"]'],
  // Any link / span of the post whose aria-label looks like a date (photo posts: the permalink is not the timestamp link).
  date_label: ['a[aria-label]', 'span[aria-label]', '[role="link"][aria-label]'],
  timestamp: ['abbr[data-utime]', '[data-utime]', 'time[datetime]', 'abbr[title]'],
  image_host: ['scontent', 'fbcdn.net'],
  image_skip: ['emoji.php', '/rsrc.php/', 'static.xx.fbcdn.net', '/p32x32/', '/p40x40/', '/s40x40/', '/p50x50/', '/s60x60/'],
  min_image: 120,
  video: ['video'],
  page_name: ['h1'],
  page_avatar: ['svg image'],
  chrome: ['[role="banner"]', '[role="navigation"]', '[role="complementary"]'],
  feed: ['[role="feed"]', '[role="main"]'],
  loader: ['[role="progressbar"]', '[data-visualcompletion="loading-state"]'],
  login_form: ['form#login_form', 'form[action*="/login"]', 'input[name="pass"]'],
  captcha: ['iframe[src*="captcha"]', 'iframe[src*="recaptcha"]', '#captcha', '[id*="captcha"]'],
  // Photos / reels tabs: grid tiles (a link + a thumbnail).
  grid_tile: ['a[href*="/photo/?fbid="]', 'a[href*="/photo.php?fbid="]', 'a[href*="/reel/"]', 'a[href*="/videos/"]'],
  done_attr: 'data-sa-seen',
};

// The posts of a page's feed that were not returned before (marked with done_attr once they had a link).
// -> { posts: [{ post_url, alt_urls, caption, date_text, utime, images: [{ src, w, h }], media_type, see_more_left }],
//      signals: { boxes, messages, post_links, feed }, page: { name, avatar }, block: { url, title, login_form, captcha, text } }
export function extractFeed(root, sel) {
  const doc = root.ownerDocument || root;
  const all = (el, list) => { const out = []; for (const s of [].concat(list)) { let f = []; try { f = [...el.querySelectorAll(s)]; } catch { f = []; } for (const x of f) if (!out.includes(x)) out.push(x); } return out; };
  const first = (el, list) => { for (const s of [].concat(list)) { try { const f = el.querySelector(s); if (f) return f; } catch { /* unsupported selector */ } } return null; };
  const BLOCK = /^(div|p|br|li|ul|ol|h\d|blockquote|section|article)$/i;
  const text = (el) => {
    let s = '';
    const walk = (n) => {
      if (n.nodeType === 3) { s += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (/^(script|style)$/i.test(tag)) return;
      if (/^img$/i.test(tag)) { s += n.getAttribute('alt') || ''; return; }
      if (/^br$/i.test(tag)) { s += '\n'; return; }
      for (const c of n.childNodes) walk(c);
      if (BLOCK.test(tag)) s += '\n';
    };
    walk(el);
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const abs = (h) => { try { return new URL(h, 'https://www.facebook.com/').href; } catch { return ''; } };
  const KEEP = ['fbid', 'story_fbid', 'id', 'v', 'set'];
  const clean = (h) => { let u; try { u = new URL(h, 'https://www.facebook.com/'); } catch { return ''; } const q = KEEP.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join('&'); return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`; };
  const DATE_LABEL = /\d.*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|th[aá]ng|ago|trước|giờ|phút|hour|min|yesterday|hôm qua)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|th[aá]ng).*\d/i;
  const POST = /\/(posts|permalink|videos|reel)\/|story_fbid=|\/photo\/?\?fbid=|\/photo\.php\?fbid=|\/photos\/|\/watch\/?\?v=/;
  const rank = (u) => (/\/(posts|permalink)\/|story_fbid=/.test(u) ? 0 : /\/(videos|reel)\/|\/watch/.test(u) ? 1 : 2);
  // el belongs to the post, not to a comment: no role=article between the box and el's nearest article.
  const own = (box, el) => {
    const a = el.closest('[role="article"]');
    if (!a || a === box || !box.contains(a)) return true;
    const up = a.parentElement && a.parentElement.closest('[role="article"]');
    return !up || (up !== box && !box.contains(up));
  };
  const isPostHref = (h) => !!h && h !== '#' && POST.test(abs(h)) && !/comment_id=|\/groups\/|\/hashtag\//.test(h);

  let boxes = all(root, sel.container);
  boxes = boxes.filter((b) => !boxes.some((o) => o !== b && o.contains(b)));
  const posts = [];
  for (const box of boxes) {
    if (sel.done_attr && box.getAttribute(sel.done_attr)) continue;
    const links = all(box, sel.post_link).filter((a) => own(box, a) && isPostHref(a.getAttribute('href')));
    // Album / photo posts: the post caption is the message of the post container, not a photo's own text (inside a photo link).
    const msgs = all(box, sel.message).filter((m) => own(box, m));
    const msg = msgs.find((m) => !m.closest('a[href*="/photo"], a[href*="/photos/"]')) || msgs[0] || null;
    const host = (src) => sel.image_host.some((h) => src.includes(h)) && !sel.image_skip.some((h) => src.includes(h));
    const imgs = [];
    for (const im of box.querySelectorAll('img')) {
      if (!own(box, im)) continue;
      const src = im.getAttribute('src') || '';
      if (!host(src) || imgs.some((x) => x.src === src)) continue;
      const w = Number(im.naturalWidth || im.getAttribute('width') || 0), h = Number(im.naturalHeight || im.getAttribute('height') || 0);
      if ((w && w < sel.min_image) || (h && h < sel.min_image)) continue;
      imgs.push({ src, w, h });
    }
    if (!links.length && !msg && !imgs.length) continue; // a loader, a header or an empty slot
    const urls = [...new Set(links.map((a) => clean(a.getAttribute('href'))).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
    const permalink = links.find((a) => clean(a.getAttribute('href')) === urls[0]);
    const ts = first(box, sel.timestamp);
    let caption = msg ? text(msg) : '';
    let seeMoreLeft = false;
    for (const t of sel.see_more_text) if (caption.endsWith(t)) { caption = caption.slice(0, -t.length).replace(/[\s…\.]+$/, '').trim(); seeMoreLeft = true; }
    // Facebook scrambles the timestamp link's text (decoy characters); the real date is the text of the element its aria-labelledby points to.
    const lbl = all(box, ['a [aria-labelledby]', 'a[aria-labelledby]']).filter((e) => own(box, e)).map((e) => { const t = doc.getElementById(e.getAttribute('aria-labelledby')); return t ? String(t.textContent || '').replace(/[͏\s]+/g, ' ').trim() : ''; }).find((x) => x.length < 40 && /\d/.test(x) && DATE_LABEL.test(x)) || '';
    const labelEl = all(box, sel.date_label || []).find((a) => own(box, a) && a.getAttribute('aria-label').length < 70 && DATE_LABEL.test(a.getAttribute('aria-label')));
    const video = all(box, sel.video).some((v) => own(box, v)) || urls.some((u) => /\/(videos|reel)\/|\/watch/.test(u));
    posts.push({
      post_url: urls[0] || '', alt_urls: urls.slice(1), caption,
      // Date: the timestamp link's aria-label / tooltip, else abbr/time; text without a digit (e.g. a name) is not a date.
      date_text: [lbl, permalink && permalink.getAttribute('aria-label'), permalink && permalink.getAttribute('title'), ts && ts.getAttribute('title'), ts && ts.getAttribute('datetime'), labelEl && labelEl.getAttribute('aria-label'), ts && text(ts), permalink && text(permalink)].map((x) => String(x || '').trim()).find((x) => /\d/.test(x)) || '',
      utime: ts ? Number(ts.getAttribute('data-utime')) || 0 : 0,
      images: imgs, media_type: video ? 'video' : imgs.length > 1 ? 'album' : imgs.length ? 'photo' : 'text', see_more_left: seeMoreLeft,
    });
    if (urls.length && sel.done_attr) box.setAttribute(sel.done_attr, '1');
  }
  const chromeEls = all(doc, sel.chrome);
  const outside = (el) => !chromeEls.some((c) => c.contains(el));
  const nameEl = all(doc, sel.page_name).find(outside);
  const av = all(doc, sel.page_avatar).find((x) => outside(x) && /scontent|fbcdn/.test(x.getAttribute('xlink:href') || x.getAttribute('href') || ''));
  const body = doc.body || doc.documentElement;
  return {
    posts,
    signals: { boxes: boxes.length, messages: all(doc, sel.message).length, post_links: all(doc, sel.post_link).length, feed: !!first(doc, sel.feed), loading: !!first(doc, sel.loader) },
    page: { name: nameEl ? text(nameEl) : '', avatar: av ? av.getAttribute('xlink:href') || av.getAttribute('href') || '' : '' },
    block: { url: (doc.location && doc.location.href) || '', title: doc.title || '', login_form: !!first(doc, sel.login_form), captcha: !!first(doc, sel.captcha), text: body ? String(body.textContent || '').slice(0, 3000) : '' },
  };
}

// Photos / reels tab: the tiles not returned before -> { tiles: [{ url, thumb, media_type }], signals, block }.
export function extractGrid(root, sel) {
  const doc = root.ownerDocument || root;
  const all = (el, list) => { const out = []; for (const s of [].concat(list)) { let f = []; try { f = [...el.querySelectorAll(s)]; } catch { f = []; } for (const x of f) if (!out.includes(x)) out.push(x); } return out; };
  const first = (el, list) => { for (const s of [].concat(list)) { try { const f = el.querySelector(s); if (f) return f; } catch { /* unsupported */ } } return null; };
  const KEEP = ['fbid', 'story_fbid', 'id', 'v', 'set'];
  const clean = (h) => { let u; try { u = new URL(h, 'https://www.facebook.com/'); } catch { return ''; } const q = KEEP.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join('&'); return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`; };
  const chromeEls = all(doc, sel.chrome);
  const tiles = [];
  for (const a of all(doc, sel.grid_tile)) {
    if (a.getAttribute(sel.done_attr) || chromeEls.some((c) => c.contains(a))) continue;
    const url = clean(a.getAttribute('href') || '');
    if (!url || tiles.some((t) => t.url === url)) continue;
    const im = a.querySelector('img');
    const src = im ? im.getAttribute('src') || '' : '';
    tiles.push({ url, thumb: /scontent|fbcdn/.test(src) ? src : '', media_type: /\/(reel|videos)\//.test(url) ? 'video' : 'photo' });
    a.setAttribute(sel.done_attr, '1');
  }
  const body = doc.body || doc.documentElement;
  return {
    tiles,
    signals: { tiles: all(doc, sel.grid_tile).length, loading: !!first(doc, sel.loader) },
    block: { url: (doc.location && doc.location.href) || '', title: doc.title || '', login_form: !!first(doc, sel.login_form), captcha: !!first(doc, sel.captcha), text: body ? String(body.textContent || '').slice(0, 3000) : '' },
  };
}

// One opened photo / reel / post page -> { post_url, alt_urls, caption, date_text, utime, images, media_type, block }.
export function extractViewer(root, sel) {
  const doc = root.ownerDocument || root;
  const all = (el, list) => { const out = []; for (const s of [].concat(list)) { let f = []; try { f = [...el.querySelectorAll(s)]; } catch { f = []; } for (const x of f) if (!out.includes(x)) out.push(x); } return out; };
  const first = (el, list) => { for (const s of [].concat(list)) { try { const f = el.querySelector(s); if (f) return f; } catch { /* unsupported */ } } return null; };
  const meta = (p) => { const m = doc.querySelector(`meta[property="${p}"]`); return m ? m.getAttribute('content') || '' : ''; };
  const text = (el) => { let s = ''; const walk = (n) => { if (n.nodeType === 3) { s += n.nodeValue; return; } if (n.nodeType !== 1) return; if (/^img$/i.test(n.tagName)) { s += n.getAttribute('alt') || ''; return; } if (/^br$/i.test(n.tagName)) { s += '\n'; return; } for (const c of n.childNodes) walk(c); if (/^(div|p|li)$/i.test(n.tagName)) s += '\n'; }; walk(el); return s.replace(/\n{3,}/g, '\n\n').trim(); };
  const KEEP = ['fbid', 'story_fbid', 'id', 'v', 'set'];
  const clean = (h) => { let u; try { u = new URL(h, 'https://www.facebook.com/'); } catch { return ''; } const q = KEEP.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join('&'); return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`; };
  const chromeEls = all(doc, sel.chrome);
  const outside = (el) => !chromeEls.some((c) => c.contains(el));
  const msg = all(doc, sel.message).find(outside);
  let caption = msg ? text(msg) : meta('og:description');
  for (const t of sel.see_more_text) if (caption.endsWith(t)) caption = caption.slice(0, -t.length).replace(/[\s…\.]+$/, '').trim();
  const host = (src) => sel.image_host.some((h) => src.includes(h)) && !sel.image_skip.some((h) => src.includes(h));
  const imgs = [...doc.querySelectorAll('img')].filter(outside).map((im) => ({ src: im.getAttribute('src') || '', w: Number(im.naturalWidth || im.getAttribute('width') || 0), h: Number(im.naturalHeight || im.getAttribute('height') || 0) }))
    .filter((x) => host(x.src) && !((x.w && x.w < sel.min_image) || (x.h && x.h < sel.min_image))).sort((a, b) => b.w * b.h - a.w * a.h);
  const og = meta('og:image');
  const images = imgs.length ? [imgs[0]] : og ? [{ src: og, w: 0, h: 0 }] : [];
  const canon = (doc.querySelector('link[rel="canonical"]') || {}).getAttribute?.('href') || meta('og:url') || (doc.location && doc.location.href) || '';
  const links = all(doc, sel.post_link).filter(outside).map((a) => clean(a.getAttribute('href') || '')).filter((u) => u && /\/(posts|permalink)\/|story_fbid=/.test(u));
  const urls = [...new Set([clean(canon), ...links].filter(Boolean))];
  const ts = first(doc, sel.timestamp);
  const tsLink = all(doc, sel.post_link).filter(outside).find((a) => a.getAttribute('aria-label'));
  const body = doc.body || doc.documentElement;
  return {
    post_url: urls[0] || '', alt_urls: urls.slice(1), caption,
    date_text: (tsLink && tsLink.getAttribute('aria-label')) || (ts && (ts.getAttribute('title') || text(ts))) || '',
    utime: ts ? Number(ts.getAttribute('data-utime')) || 0 : 0,
    images, media_type: first(doc, sel.video) || /\/(reel|videos)\//.test(urls[0] || '') ? 'video' : 'photo',
    block: { url: (doc.location && doc.location.href) || '', title: doc.title || '', login_form: !!first(doc, sel.login_form), captcha: !!first(doc, sel.captcha), text: body ? String(body.textContent || '').slice(0, 3000) : '' },
  };
}

// ---------- Node side ----------
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Facebook's timestamp text -> YYYY-MM-DD in the local calendar ('' when unknown): "Just now", "5m", "3 hrs", "2d",
// "1w", "Yesterday at 9:00", "November 2 at 10:00 AM", "November 2, 2024", "2 November 2024", "Vừa xong", "3 giờ",
// "2 ngày", "1 tuần", "Hôm qua lúc 9:00", "2 tháng 11", "2 tháng 11, 2024"; a unix time wins when present.
export function parseFbDate(textIn, now = new Date(), utime = 0) {
  if (utime) return ymd(new Date(utime * 1000));
  const t = String(textIn || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return ymd(d); };
  if (/^(just now|vừa xong|now)/.test(t)) return ymd(now);
  let m = t.match(/^(\d+)\s*(m|min|mins|minutes?|phút|h|hr|hrs|hours?|giờ|d|days?|ngày|w|wk|weeks?|tuần|y|yr|years?|năm)(?!\p{L})/u);
  if (m) {
    const n = Number(m[1]), u = m[2];
    if (/^(m|min|mins|minute|minutes|phút)$/.test(u)) return ymd(new Date(now.getTime() - n * 60000));
    if (/^(h|hr|hrs|hour|hours|giờ)$/.test(u)) return ymd(new Date(now.getTime() - n * 3600000));
    if (/^(d|day|days|ngày)$/.test(u)) return back(n);
    if (/^(w|wk|week|weeks|tuần)$/.test(u)) return back(7 * n);
    return '';
  }
  if (/^(yesterday|hôm qua)/.test(t)) return back(1);
  const build = (y, mo, d) => {
    let year = y || now.getFullYear();
    let date = new Date(year, mo, d);
    if (!y && date > now) date = new Date(year - 1, mo, d);
    return date.getMonth() === mo && date.getDate() === d ? ymd(date) : '';
  };
  m = t.match(/\b([a-z]+)\s+(\d{1,2})(?!\d)(?:,\s*(\d{4}))?/); // November 2[, 2024]
  if (m && MONTHS[m[1]] !== undefined) return build(Number(m[3]) || 0, MONTHS[m[1]], Number(m[2]));
  m = t.match(/\b(\d{1,2})\s+([a-z]+)(?:,?\s*(\d{4}))?/); // 2 November[ 2024]
  if (m && MONTHS[m[2]] !== undefined) return build(Number(m[3]) || 0, MONTHS[m[2]], Number(m[1]));
  m = t.match(/(\d{1,2})\s+tháng\s+(\d{1,2})(?:,?\s*(?:năm\s+)?(\d{4}))?/); // 2 tháng 11[, 2024]
  if (m) return build(Number(m[3]) || 0, Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 2/11/2024 (day first)
  if (m) return build(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return '';
}

// Checkpoint, captcha, "temporarily blocked", login wall -> the reason ('' = fine). Stop the crawl at once.
const BLOCK_TEXT = [/temporarily blocked/i, /tạm thời bị chặn/i, /security check/i, /kiểm tra bảo mật/i, /confirm (it'?s|that it'?s) you/i, /xác nhận (danh tính|đó là bạn)/i, /you must log in/i, /log in to continue/i, /bạn phải đăng nhập/i, /đăng nhập để tiếp tục/i, /your account has been (locked|suspended)/i, /tài khoản của bạn (đã bị khoá|đã bị khóa|bị tạm khoá|bị tạm khóa)/i];
export function detectBlock(b = {}) {
  const url = String(b.url || '');
  if (/\/checkpoint\b/i.test(url)) return `checkpoint (${url.slice(0, 80)})`;
  if (/\/login(\.php|\/|\?|$)|\/recover\//i.test(url)) return 'login wall: Facebook asks to log in';
  if (b.captcha) return 'captcha';
  if (b.login_form) return 'login wall: login form on the page (Chrome not signed in?)';
  const hit = BLOCK_TEXT.find((r) => r.test(`${b.title || ''} ${b.text || ''}`));
  return hit ? `blocked: "${(`${b.title || ''} ${b.text || ''}`.match(hit) || [''])[0]}"` : '';
}

// A source's other tabs: posts (feed), photos (grid, the page's own photos), reels (grid).
export function tabUrl(url, tab) {
  let u; try { u = new URL(url); } catch { return url; }
  if (/profile\.php$/.test(u.pathname)) {
    const sk = { posts: '', photos: 'photos_by', reels: 'reels_tab' }[tab];
    if (sk) u.searchParams.set('sk', sk); else u.searchParams.delete('sk');
    return u.href;
  }
  const base = u.pathname.split('/').filter(Boolean)[0] || '';
  return `${u.origin}/${base}${{ posts: '/posts', photos: '/photos_by', reels: '/reels' }[tab] ?? ''}`;
}
export const TAB_MODE = { feed: 'feed', posts: 'feed', photos: 'grid', reels: 'grid' };
