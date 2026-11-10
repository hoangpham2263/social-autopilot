// Direct fetch routes (no browser): shared parts. A route = scripts/platforms/fetch/<platform>.mjs with
//   { platform, requestFor(task) -> { url, via: 'fetch'|'curl' }, parse(text, task) -> tiles[{ url, image_urls[], caption, author }], adapter }
// Read only, polite: >= 5 s between two requests to the same host (kept in a small state file so separate commands obey it too),
// HTTP 429/403 or a block page = STOP and mark the host blocked for a while (never retried in a loop), 5xx = at most
// two retries with exponential backoff, a network error (no HTTP answer) fails fast: at most 1 retry after 3 s. No cookies, no tokens, no proxies.
export const MIN_GAP_MS = 5000;
export const BLOCK_MS = 30 * 60 * 1000;
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class BlockedError extends Error {
  constructor(message, { status = 0, host = '' } = {}) { super(message); this.name = 'BlockedError'; this.blocked = true; this.status = status; this.host = host; }
}
export const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };
export const unescapeXml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#32;/g, ' ').replace(/&amp;/g, '&');
export const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Per-host gap + block memory. state: { [host]: { last, blocked_until } } (a plain object; `save` persists it). Clock and sleep are injected.
export function makeLimiter({ state = {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = MIN_GAP_MS, blockMs = BLOCK_MS, save = () => {} } = {}) {
  const gap = Math.max(gapMs, MIN_GAP_MS);
  return {
    state, gap,
    // Wait until `gap` has passed since the last request to the host; throws BlockedError while the host is marked blocked.
    async wait(host) {
      const s = state[host] || {};
      if (s.blocked_until && now() < s.blocked_until) throw new BlockedError(`blocked, try later: ${host} refused us earlier (retry after ${new Date(s.blocked_until).toISOString()})`, { host });
      const left = (s.last || 0) + gap - now();
      if (left > 0) await sleep(left);
      state[host] = { ...s, last: now() };
      save(state);
    },
    block(host) { state[host] = { ...(state[host] || {}), last: now(), blocked_until: now() + blockMs }; save(state); },
  };
}

// HTTP status / body of a response -> a reason ('' = fine). 429/403 = refused; a short challenge page counts too.
export function blockReason(status, text = '') {
  if (status === 429) return 'HTTP 429 too many requests';
  if (status === 403) return 'HTTP 403 forbidden';
  const t = String(text);
  if (t.length < 20000 && /captcha|unusual traffic|verify (that )?you are (a )?human|blocked by network security|access denied/i.test(t.slice(0, 4000))) return 'block / captcha page';
  return '';
}

// One polite GET: limiter.wait, then get(request) -> { status, text }. Blocked -> BlockedError (host marked, NO retry).
// 5xx -> retried at most `retries` times, waiting gap * 2^n (exponential); a network error -> at most 1 retry after netRetryMs (3 s); then an Error.
export async function politeGet(req, get, { limiter, retries = 2, netRetryMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const host = hostOf(req.url);
  let lastErr = '', netErrors = 0;
  for (let n = 0; n <= retries; n++) {
    await limiter.wait(host);
    let r = null;
    try { r = await get(req); } catch (e) { lastErr = String(e.message || e).slice(0, 120); netErrors++; }
    if (r) {
      const why = blockReason(r.status, r.text);
      if (why) { limiter.block(host); throw new BlockedError(`blocked, try later: ${host} answered ${why}`, { status: r.status, host }); }
      if (r.status >= 200 && r.status < 300) return r.text;
      lastErr = `HTTP ${r.status}`;
      if (r.status < 500) break; // other 4xx: retrying will not help
    }
    if (!r) { if (netErrors > 1) break; await sleep(netRetryMs); continue; } // network error: one quick retry only
    if (n < retries) await sleep(limiter.gap * 2 ** n);
  }
  throw new Error(`${host}: ${lastErr || 'request failed'}`);
}
