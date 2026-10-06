'use strict';

/* Service worker: بيحفظ ملفات التطبيق على الجهاز عشان يفتح من غير إنترنت.
   الاستراتيجية: يفتح من النسخة المحفوظة على طول، وفي الخلفية يجيب أحدث نسخة لو فيه نت
   (فالتحديثات بتظهر في المرة اللي بعدها). غيّر VERSION لما تحب تجبر تحديث كامل. */
const VERSION = 'v2';
const CACHE = `organize-it-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'style.css',
  'i18n.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'favicon.ico',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('organize-it-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    // فتح الصفحة نفسها (أي رابط جوه التطبيق) = index.html
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('Offline', { status: 503, statusText: 'Offline' });
  }));
});
