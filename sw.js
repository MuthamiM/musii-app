/* musii/sw.js - runtime caching for a bundled web app (hashed asset names). Register it from your entry file:
 *   if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
 * Strategies: stale-while-revalidate (same-origin GET + lrclib.net) | network-first navigation with an offline
 * shell | range-aware audio cache, filled only on request:
 *   navigator.serviceWorker.controller.postMessage({ type: 'cache-audio', url })
 * Same-origin API paths are never cached: list them in API_PREFIXES. */
const RUNTIME = 'musii-rt-v1',
  AUDIO = 'musii-audio-v1',
  MAX_AUDIO = 30,
  SHELL_KEY = '/__musii_shell';
const API_PREFIXES = ['/api/'];

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> [start, end] inclusive, or null when absent / invalid
function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let a, b;
  if (m[1] === '') {
    a = Math.max(0, size - +m[2]);
    b = size - 1;
  } // suffix range: last n bytes
  else {
    a = +m[1];
    b = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1);
  }
  return a > b || a >= size ? null : [a, b];
}
// <audio> sends Range requests; a cached full file must answer them with 206 or seeking breaks
function rangeResponse(buf, range, type) {
  const size = buf.byteLength,
    r = parseRange(range, size);
  const h = { 'Content-Type': type || 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  if (!r) return new Response(buf, { status: 200, headers: { ...h, 'Content-Length': String(size) } });
  return new Response(buf.slice(r[0], r[1] + 1), {
    status: 206,
    headers: {
      ...h,
      'Content-Range': 'bytes ' + r[0] + '-' + r[1] + '/' + size,
      'Content-Length': String(r[1] - r[0] + 1),
    },
  });
}
function strategy(req, origin) {
  if (req.method !== 'GET') return 'network';
  const u = new URL(req.url);
  if (req.destination === 'audio') return 'audio';
  if (req.mode === 'navigate') return 'nav';
  if (u.origin === origin && API_PREFIXES.some((p) => u.pathname.startsWith(p))) return 'network';
  return u.origin === origin || u.hostname === 'lrclib.net' ? 'swr' : 'network';
}

async function swr(req, ev) {
  const c = await caches.open(RUNTIME),
    hit = await c.match(req);
  const net = fetch(req)
    .then((r) => {
      if (r.ok) c.put(req, r.clone());
      return r;
    })
    .catch(() => null);
  if (hit) {
    ev.waitUntil(net);
    return hit;
  }
  return (await net) || Response.error();
}
async function nav(req) {
  const c = await caches.open(RUNTIME);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(SHELL_KEY, r.clone());
    return r;
  } catch (e) {
    return (await c.match(SHELL_KEY)) || Response.error();
  }
}
async function audio(req) {
  const c = await caches.open(AUDIO),
    hit = await c.match(req.url);
  return hit
    ? rangeResponse(await hit.arrayBuffer(), req.headers.get('range'), hit.headers.get('Content-Type'))
    : fetch(req);
}
async function cacheAudio(url) {
  const c = await caches.open(AUDIO);
  if (await c.match(url)) return;
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error('audio ' + r.status);
  await c.put(url, r);
  const ks = await c.keys();
  for (const k of ks.slice(0, Math.max(0, ks.length - MAX_AUDIO))) await c.delete(k); // evict oldest first
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) =>
    e.waitUntil(
      caches
        .keys()
        .then((ks) =>
          Promise.all(
            ks
              .filter((k) => k.startsWith('musii-') && k !== RUNTIME && k !== AUDIO)
              .map((k) => caches.delete(k)),
          ),
        )
        .then(() => self.clients.claim()),
    ),
  );
  self.addEventListener('fetch', (e) => {
    const s = strategy(e.request, self.location.origin);
    if (s === 'swr') e.respondWith(swr(e.request, e));
    else if (s === 'nav') e.respondWith(nav(e.request));
    else if (s === 'audio') e.respondWith(audio(e.request));
  });
  self.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'cache-audio' && d.url) e.waitUntil(cacheAudio(d.url).catch(() => {}));
  });
}
if (typeof module === 'object' && module.exports) module.exports = { parseRange, rangeResponse, strategy };
