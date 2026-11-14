const CACHE_NAME = 'bitchord-cache-v1.9.1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/styles/colors.css',
  '/styles/glass.css',
  '/styles/animations.css',
  '/styles/base.css',
  '/styles/components/bottom-nav.css',
  '/styles/components/mini-player.css',
  '/styles/components/expanded-player.css',
  '/styles/components/cards.css',
  '/styles/components/modal.css',
  '/js/main.js',
  '/js/constants/colors.js',
  '/js/constants/themes.js',
  '/js/constants/tracks.js',
  '/js/errors/clientErrorHandler.js',
  '/js/middleware/hapticMiddleware.js',
  '/js/services/AudioSynthService.js',
  '/js/services/StorageService.js',
  '/js/controllers/AudioController.js',
  '/js/controllers/NavigationController.js',
  '/js/controllers/PlaylistController.js',
  '/js/controllers/ModalController.js',
  '/js/controllers/AppController.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log('PWA cache warm', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Network first for API, cache first for static assets
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(res => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
  }
});

